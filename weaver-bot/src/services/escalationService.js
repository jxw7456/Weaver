const {
  ChannelType,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ThreadAutoArchiveDuration,
} = require("discord.js");
const logger = require("../utils/logger");
const prisma = require("../utils/prisma");
const docsMcpService = require("./docsMcpService");

// When escalating to partner-escalations, copy this many of the most-recent
// triage thread messages into the new thread as a transcript, so partner-esc
// readers see the conversation so far. New messages after this point flow
// through the live mirror in maybeForwardMessage().
const TRANSCRIPT_FETCH_LIMIT = 50;

class EscalationService {
  /**
   * Whether a member is allowed to use the context menu and the escalate button.
   *
   * Configure via ESCALATION_STAFF_ROLE_IDS (comma-separated role IDs).
   * If unset, falls back to ManageMessages
   */
  async userIsAllowed(member) {
    if (!member) return false;
    const allowedRoles = (process.env.ESCALATION_STAFF_ROLE_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowedRoles.length === 0) {
      return member.permissions?.has?.("ManageMessages") ?? false;
    }
    return member.roles.cache.some((r) => allowedRoles.includes(r.id));
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 1: Context menu → create a thread under the message.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Creates a public thread off the targeted message in the same channel.
   * Posts a context embed inside the new thread with an "Escalate to
   * Partner Escalations" button.
   */
  async createTriageThread({ client, targetMessage, triggeredBy }) {
    // Idempotency — if we've already triaged this message, surface the
    // existing thread instead of creating a duplicate.
    const existing = await prisma.escalation
      .findUnique({
        where: { sourceMessageId: targetMessage.id },
      })
      .catch(() => null);
    if (existing) {
      return {
        success: true,
        threadId: existing.triageThreadId,
        threadUrl: this.threadUrl(
          existing.triageGuildId,
          existing.triageThreadId,
        ),
        duplicate: true,
      };
    }

    // startThread() only works on top-level channel messages, not on messages
    // already inside a thread. Guard against both with a clear error.
    if (targetMessage.channel?.isThread?.()) {
      return {
        success: false,
        error:
          "This message is already inside a thread. Right-click a top-level channel message instead.",
      };
    }
    if (targetMessage.hasThread) {
      return {
        success: false,
        error:
          "This message already has a thread attached. Open it from the message itself.",
      };
    }

    const partnerCompany = this.guessPartnerCompany(targetMessage.channel);
    const sourceContent =
      targetMessage.content ||
      "*(no text content — possibly an embed/attachment)*";

    let triageThread;
    try {
      triageThread = await targetMessage.startThread({
        name: this.buildThreadTitle({
          partnerCompany,
          partnerName: targetMessage.author?.username,
          messageContent: sourceContent,
        }),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Thread created by ${triggeredBy.tag}`,
      });
    } catch (err) {
      logger.error("Failed to start thread:", err);
      return { success: false, error: err.message };
    }

    const sourceUrl = `https://discord.com/channels/${targetMessage.guild?.id ?? "@me"}/${targetMessage.channel.id}/${targetMessage.id}`;

    // Post the context embed + escalate button. The button's customId encodes
    // the source message ID — that's our DB lookup key on click.
    const contextEmbed = new EmbedBuilder()
      .setTitle("🎯 Triage Thread")
      .setColor(0xffa500)
      .setDescription(
        `Started by <@${triggeredBy.id}>. Discuss here freely — most issues can be ` +
          `resolved without escalating. Hit the button below if this needs cross-team ` +
          `attention from the partner-escalations forum.`,
      )
      .addFields(
        {
          name: "Partner",
          value: partnerCompany || targetMessage.author?.username || "Unknown",
          inline: true,
        },
        {
          name: "Original Author",
          value: targetMessage.author ? `<@${targetMessage.author.id}>` : "—",
          inline: true,
        },
        {
          name: "Source",
          value: `[Jump to message](${sourceUrl})`,
          inline: true,
        },
        { name: "Original Message", value: sourceContent.slice(0, 1024) },
      )
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`escalation_send_${targetMessage.id}`)
        .setLabel("Escalate to Partner Escalations")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🚨"),
      new ButtonBuilder()
        .setCustomId(`escalation_resolve_${targetMessage.id}`)
        .setLabel("Mark Resolved")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅"),
    );

    await triageThread.send({
      embeds: [contextEmbed],
      components: [actionRow],
    });

    // Persist. The triage thread shares its ID with the source message
    // (Discord-side detail), but we store both explicitly for clarity.
    try {
      await prisma.escalation.create({
        data: {
          triageThreadId: triageThread.id,
          triageGuildId: triageThread.guild.id,
          triageChannelId: targetMessage.channel.id,
          sourceMessageId: targetMessage.id,
          sourceMessageUrl: sourceUrl,
          sourceContent: sourceContent.slice(0, 4000),
          sourceAuthorId: targetMessage.author?.id ?? null,
          sourceAuthorName: targetMessage.author?.username ?? null,
          partnerCompany,
          triggeredBy: triggeredBy.id,
          status: "triage",
        },
      });
    } catch (err) {
      logger.warn(
        "Could not persist escalation record (non-fatal):",
        err.message,
      );
    }

    logger.info(
      `Triage thread created: thread=${triageThread.id} src=${targetMessage.id} by=${triggeredBy.tag}`,
    );

    return {
      success: true,
      threadId: triageThread.id,
      threadUrl: this.threadUrl(triageThread.guild.id, triageThread.id),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 2: Button click → escalate to the cross-server partner-escalations forum.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Triggered by the "Escalate to Partner Escalations" button in a triage
   * thread. Creates a thread in the partner-escalations forum (in the
   * UDP server), seeds it with the original message
   * + a transcript of the triage discussion so far, and flips the DB
   * record's status so messageCreate's mirror starts forwarding new replies.
   */
  async escalateToPartnerForum({ client, sourceMessageId, triggeredBy }) {
    const escalation = await prisma.escalation.findUnique({
      where: { sourceMessageId },
    });
    if (!escalation) {
      return {
        success: false,
        error:
          "Triage thread not found in DB. Was it created with /Create Thread?",
      };
    }
    if (escalation.status !== "triage") {
      return {
        success: false,
        error: `Already ${escalation.status}. Existing thread: ${this.threadUrl(escalation.escalationGuildId, escalation.escalationThreadId)}`,
      };
    }

    const forumId = process.env.ESCALATION_FORUM_CHANNEL_ID;
    if (!forumId) {
      return {
        success: false,
        error: "ESCALATION_FORUM_CHANNEL_ID is not configured.",
      };
    }

    const forum = await client.channels.fetch(forumId).catch(() => null);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      return {
        success: false,
        error:
          "Escalation forum channel not found or is not a forum. Check ESCALATION_FORUM_CHANNEL_ID and that the bot is in that server.",
      };
    }

    // Pull the triage thread so we can grab a transcript of the discussion so far.
    const triageThread = await client.channels
      .fetch(escalation.triageThreadId)
      .catch(() => null);
    const transcript = triageThread
      ? await this.fetchTranscript(triageThread)
      : [];

    const escalationEmbed = new EmbedBuilder()
      .setTitle("🚨 Escalated from Studio Connect")
      .setColor(0xff6b6b)
      .addFields(
        {
          name: "Partner",
          value:
            escalation.partnerCompany ||
            escalation.sourceAuthorName ||
            "Unknown",
          inline: true,
        },
        {
          name: "Original Author",
          value: escalation.sourceAuthorId
            ? `<@${escalation.sourceAuthorId}>`
            : "—",
          inline: true,
        },
        { name: "Escalated By", value: `<@${triggeredBy.id}>`, inline: true },
        {
          name: "Original Message",
          value: escalation.sourceContent.slice(0, 1024),
        },
        {
          name: "Original Thread",
          value: `[Open in Studio Connect](${this.threadUrl(escalation.triageGuildId, escalation.triageThreadId)})`,
        },
        {
          name: "Source Message",
          value: `[Jump to original](${escalation.sourceMessageUrl})`,
        },
      )
      .setFooter({
        text: "New messages in the original thread will mirror here automatically.",
      })
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`escalation_resolve_${sourceMessageId}`)
        .setLabel("Mark Resolved")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅"),
    );

    let escalationThread;
    try {
      escalationThread = await forum.threads.create({
        name: this.buildThreadTitle({
          partnerCompany: escalation.partnerCompany,
          partnerName: escalation.sourceAuthorName,
          messageContent: escalation.sourceContent,
        }),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Escalated by ${triggeredBy.tag}`,
        message: { embeds: [escalationEmbed], components: [actionRow] },
      });
    } catch (err) {
      logger.error("Failed to create partner-escalations thread:", err);
      return { success: false, error: err.message };
    }

    // Drop the transcript as a follow-up so the embed stays the readable header.
    if (transcript.length > 0) {
      const transcriptText =
        "**📜 Thread discussion so far:**\n\n" +
        transcript
          .map((m) => `**${m.author}:** ${m.content}`)
          .join("\n")
          .slice(0, 1900);
      await escalationThread
        .send({
          content: transcriptText,
          allowedMentions: { parse: [] },
        })
        .catch((err) => logger.warn("Could not post transcript:", err.message));
    }

    // Update DB so mirroring kicks in.
    await prisma.escalation.update({
      where: { sourceMessageId },
      data: {
        escalationThreadId: escalationThread.id,
        escalationGuildId: escalationThread.guild.id,
        escalationForumId: forum.id,
        escalatedBy: triggeredBy.id,
        escalatedAt: new Date(),
        status: "escalated",
      },
    });

    // Optional Step 4: docs MCP draft response.
    if (process.env.ENABLE_MCP_DRAFT === "true") {
      this.postDraftResponse(escalationThread, escalation.sourceContent).catch(
        (err) => logger.error("postDraftResponse failed:", err),
      );
    }

    logger.info(
      `Escalated to partner forum: triage=${escalation.triageThreadId} → escalation=${escalationThread.id} by=${triggeredBy.tag}`,
    );

    return {
      success: true,
      threadId: escalationThread.id,
      threadUrl: this.threadUrl(escalationThread.guild.id, escalationThread.id),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 3: Live mirror — forward new triage-thread messages to the escalation thread.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Called from messageCreate event for every non-bot thread message.
   * Looks up whether the message's thread is an escalated triage thread
   * and, if so, forwards the message into the partner-escalations thread.
   *
   * WHY an event listener instead of a discord.js message collector:
   *   - Survives bot restarts. Collectors die on restart and have to be
   *     re-armed; the DB-backed event approach is naturally durable.
   *   - No accumulating timers. With a long-lived bot in many threads,
   *     leftover collectors add up.
   *   - The collector's batching strength (bundle 60s of replies into one
   *     payload for Zendesk) doesn't pay off here — Discord-to-Discord
   *     forwarding is cheap, and partner-esc readers benefit from seeing
   *     replies as they happen.
   * If we ever want batched forwarding (less spammy in partner-esc), the
   * batching layer slots in here without changing the rest of the design.
   */
  async maybeForwardMessage(message) {
    const escalation = await prisma.escalation
      .findUnique({
        where: { triageThreadId: message.channel.id },
      })
      .catch(() => null);

    if (
      !escalation ||
      escalation.status !== "escalated" ||
      !escalation.escalationThreadId
    ) {
      return;
    }

    const destThread = await message.client.channels
      .fetch(escalation.escalationThreadId)
      .catch(() => null);
    if (!destThread) {
      logger.warn(
        `Mirror destination ${escalation.escalationThreadId} not found; cannot forward.`,
      );
      return;
    }

    const author = message.author?.username ?? "unknown";
    const content = message.content || "*(no text)*";
    const attachmentList =
      message.attachments.size > 0
        ? "\n\n📎 " +
          Array.from(message.attachments.values())
            .map((a) => `[${a.name}](${a.url})`)
            .join(", ")
        : "";

    const forwarded = `**${author}:** ${content}${attachmentList}`;

    await destThread
      .send({
        // Stay under the 2000-char limit; truncate worst case rather than fail.
        content: forwarded.slice(0, 2000),
        // Suppress all mention pings — the partner's @ won't resolve in the
        // dest server anyway, and we don't want stray @everyone in either.
        allowedMentions: { parse: [] },
      })
      .catch((err) => logger.error("Forward failed:", err));
  }

  // ─────────────────────────────────────────────────────────────────────
  // Resolve — called by the "Mark Resolved" button handler.
  // ─────────────────────────────────────────────────────────────────────

  async markResolved(sourceMessageId, resolvedBy) {
    return prisma.escalation.update({
      where: { sourceMessageId },
      data: {
        status: "resolved",
        resolvedBy,
        resolvedAt: new Date(),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  threadUrl(guildId, threadId) {
    if (!guildId || !threadId) return "(unknown thread)";
    return `https://discord.com/channels/${guildId}/${threadId}`;
  }

  /**
   * Studio Connect partner channels are typically named after the partner
   * studio (e.g. "embark", "triangle-studios"). Best-effort extraction —
   * staff can rename the thread after the fact if it's wrong.
   */
  guessPartnerCompany(channel) {
    if (!channel?.name) return null;
    return channel.name
      .replace(/^(studio-|partner-)/i, "")
      .replace(/(-help|-support)$/i, "")
      .replace(/-/g, " ")
      .trim();
  }

  buildThreadTitle({ partnerCompany, partnerName, messageContent }) {
    const partner = partnerCompany || partnerName || "Unknown";
    const snippet = (messageContent || "").replace(/\s+/g, " ").slice(0, 60);
    return `[${partner}] ${snippet}`.slice(0, 95);
  }

  /**
   * Fetch up to TRANSCRIPT_FETCH_LIMIT messages from the triage thread,
   * skipping the bot's own context-embed message (the thread starter).
   * Returned in chronological order.
   */
  async fetchTranscript(thread) {
    try {
      const fetched = await thread.messages.fetch({
        limit: TRANSCRIPT_FETCH_LIMIT,
      });
      return Array.from(fetched.values())
        .filter((m) => !m.author.bot && m.content) // skip our own embeds + empty messages
        .reverse() // chronological
        .map((m) => ({
          author: m.author.username,
          content: m.content.slice(0, 200),
        }));
    } catch (err) {
      logger.debug(`Could not fetch transcript: ${err.message}`);
      return [];
    }
  }

  /**
   * Step 4 (optional): query the docs MCP and post a draft response.
   */
  async postDraftResponse(thread, query) {
    const draft = await docsMcpService.queryDocs(query);
    if (!draft || !draft.text) return;

    const embed = new EmbedBuilder()
      .setAuthor({ name: "🤖 Weaver — Draft Response (review before sending)" })
      .setDescription(draft.text.slice(0, 4000))
      .setColor(0x7289da)
      .setFooter({
        text: "Sources below — verify before responding to the partner",
      });

    if (draft.sources?.length) {
      embed.addFields({
        name: "Sources",
        value: draft.sources
          .slice(0, 5)
          .map((s) => `• [${s.title}](${s.url})`)
          .join("\n"),
      });
    }

    await thread.send({ embeds: [embed] });
  }
}

module.exports = new EscalationService();