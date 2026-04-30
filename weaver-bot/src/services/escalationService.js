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

// Pull recent thread history for context (skip the targeted message itself).
const HISTORY_FETCH_LIMIT = 6;
const HISTORY_INCLUDE_LIMIT = 5;

class EscalationService {
  /**
   * Whether a member is allowed to use the escalate command.
   *
   * Configure via ESCALATION_STAFF_ROLE_IDS (comma-separated role IDs).
   * If unset, falls back to the Manage Messages permission, which keeps
   * the context menu coarse-gated until DevOps/DevRel decide on a role.
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

  /**
   * Main entry point. Creates a thread in the escalation forum with full
   * context and (optionally) a draft response from the docs MCP.
   */
  async escalate({ client, targetMessage, triggeredBy }) {
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
        error: "Escalation forum channel not found or is not a forum.",
      };
    }

    // Idempotency: if we've already escalated this exact message, surface the
    // existing thread instead of creating a duplicate.
    const existing = await prisma.escalation
      .findUnique({
        where: { sourceMessageId: targetMessage.id },
      })
      .catch(() => null);
    if (existing) {
      return {
        success: true,
        threadId: existing.threadId,
        threadUrl: `https://discord.com/channels/${existing.guildId}/${existing.threadId}`,
        duplicate: true,
      };
    }

    const context = await this.buildContext(targetMessage, triggeredBy);
    const title = this.buildThreadTitle(context);
    const contextEmbed = this.buildContextEmbed(context);

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`escalation_resolve_${targetMessage.id}`)
        .setLabel("Mark Resolved")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅"),
      new ButtonBuilder()
        .setURL(context.sourceUrl)
        .setLabel("Jump to Original Message")
        .setStyle(ButtonStyle.Link),
    );

    let thread;
    try {
      thread = await forum.threads.create({
        name: title,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Escalated by ${triggeredBy.tag}`,
        message: {
          embeds: [contextEmbed],
          components: [actionRow],
        },
      });
    } catch (err) {
      logger.error("Failed to create escalation thread:", err);
      return { success: false, error: err.message };
    }

    // Persist to DB so the future weekly report can read longitudinal data
    // without scraping Discord every time. Non-fatal if it fails — the
    // thread itself is the source of truth.
    try {
      await prisma.escalation.create({
        data: {
          threadId: thread.id,
          forumId: forum.id,
          guildId: thread.guild.id,
          sourceChannelId: targetMessage.channel.id,
          sourceMessageId: targetMessage.id,
          sourceUrl: context.sourceUrl,
          sourceContent: context.messageContent.slice(0, 4000),
          partnerUserId: targetMessage.author?.id ?? null,
          partnerUsername: context.partnerName,
          partnerCompany: context.partnerCompany,
          triggeredBy: triggeredBy.id,
          status: "open",
        },
      });
    } catch (err) {
      logger.warn(
        "Could not persist escalation record (non-fatal):",
        err.message,
      );
    }

    // Automated Responses — feature-flagged so we can ship Feature 1 without it and turn
    // it on the moment Mark/Clint hand over the MCP URL + auth.
    if (process.env.ENABLE_MCP_DRAFT === "true") {
      this.postDraftResponse(thread, context).catch((err) =>
        logger.error("postDraftResponse failed:", err),
      );
    }

    logger.info(
      `Escalation created: thread=${thread.id} src=${targetMessage.id} by=${triggeredBy.tag}`,
    );

    return {
      success: true,
      threadId: thread.id,
      threadUrl: `https://discord.com/channels/${thread.guild.id}/${thread.id}`,
    };
  }

  /**
   * Pulls all the context we want sitting at the top of the thread.
   */
  async buildContext(targetMessage, triggeredBy) {
    const channel = targetMessage.channel;
    const guild = targetMessage.guild;
    const author = targetMessage.author;

    const partnerCompany = this.guessPartnerCompany(channel);

    // Fetch a few messages BEFORE the target for surrounding context.
    let history = [];
    try {
      const fetched = await channel.messages.fetch({
        limit: HISTORY_FETCH_LIMIT,
        before: targetMessage.id,
      });
      history = Array.from(fetched.values())
        .reverse() // chronological order
        .slice(-HISTORY_INCLUDE_LIMIT);
    } catch (err) {
      logger.debug(`Could not fetch history for context: ${err.message}`);
    }

    const sourceUrl = `https://discord.com/channels/${guild?.id ?? "@me"}/${channel.id}/${targetMessage.id}`;

    return {
      partnerName: author?.username ?? "Unknown",
      partnerId: author?.id ?? null,
      partnerCompany,
      sourceChannelName: channel?.name ?? "DM",
      sourceChannelId: channel.id,
      sourceGuildName: guild?.name ?? "Direct Message",
      sourceUrl,
      messageContent:
        targetMessage.content ||
        "*(no text content — possibly an embed/attachment)*",
      timestamp: targetMessage.createdAt,
      triggeredBy,
      history,
    };
  }

  /**
   * Heuristic: Studio Connect partner channels are typically named after the
   * partner studio (e.g. "embark", "triangle-studios"). This is a best-effort
   * extraction — staff can always rename the thread after the fact.
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
    const snippet = messageContent.replace(/\s+/g, " ").slice(0, 60);
    // Discord caps thread names at 100 chars; leave a small buffer.
    return `[${partner}] ${snippet}`.slice(0, 95);
  }

  buildContextEmbed(ctx) {
    const historyText = ctx.history.length
      ? ctx.history
          .map(
            (m) =>
              `**${m.author?.username ?? "unknown"}:** ${(m.content || "*[non-text]*").slice(0, 200)}`,
          )
          .join("\n")
          .slice(0, 1024)
      : "*No prior context*";

    return new EmbedBuilder()
      .setTitle("🚨 New Partner Escalation")
      .setColor(0xff6b6b)
      .addFields(
        {
          name: "Partner",
          value: ctx.partnerCompany || ctx.partnerName,
          inline: true,
        },
        {
          name: "User",
          value: ctx.partnerId ? `<@${ctx.partnerId}>` : "—",
          inline: true,
        },
        {
          name: "Source",
          value: `${ctx.sourceGuildName} → #${ctx.sourceChannelName}`,
          inline: true,
        },
        { name: "Original Message", value: ctx.messageContent.slice(0, 1024) },
        { name: "Recent Thread Context", value: historyText },
        {
          name: "Escalated By",
          value: `<@${ctx.triggeredBy.id}>`,
          inline: true,
        },
        {
          name: "Original Timestamp",
          value: `<t:${Math.floor(ctx.timestamp.getTime() / 1000)}:f>`,
          inline: true,
        },
        {
          name: "Jump to Source",
          value: `[Click here](${ctx.sourceUrl})`,
          inline: true,
        },
      )
      .setTimestamp();
  }

  /**
   * Automated Responses (optional): query the docs MCP and post a draft response.
   *
   * Reads from the partner's message; later turns of @mentioning the bot
   * in-thread (Feature 2) will read full thread history instead.
   */
  async postDraftResponse(thread, context) {
    const draft = await docsMcpService.queryDocs(context.messageContent);
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

  /**
   * Called by the "Mark Resolved" button handler in interactionCreate.
   */
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
}

module.exports = new EscalationService();