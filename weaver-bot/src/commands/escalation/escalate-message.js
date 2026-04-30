const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
} = require("discord.js");
const escalationService = require("../../services/escalationService");
const logger = require("../../utils/logger");

/**
 * Right-click any message → "Escalate to #partner-escalations".
 *
 * Works from anywhere a staff member can see — Studio Connect partner
 * channels, #partner-escalations itself, DMs to staff, etc. The bot
 * does the work of pulling the context together and dropping it as a
 * new thread in the escalation forum.
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName("Escalate to #partner-escalations")
    .setType(ApplicationCommandType.Message)
    // Coarse gate — only members with Manage Messages see this option.
    // The fine-grained role check happens in escalationService.userIsAllowed.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    // Discord requires this flag for context menus on messages from DMs;
    // we want guild-only since the destination forum is in a guild.
    .setDMPermission(false),

  async execute(interaction) {
    // Defer ephemerally so the user gets immediate "working on it" feedback.
    // Thread creation can take a couple seconds, especially with history fetch.
    await interaction.deferReply({ ephemeral: true });

    const targetMessage = interaction.targetMessage;

    try {
      const allowed = await escalationService.userIsAllowed(interaction.member);
      if (!allowed) {
        return interaction.editReply({
          content: "❌ You do not have permission to escalate messages.",
        });
      }

      const result = await escalationService.escalate({
        client: interaction.client,
        targetMessage,
        triggeredBy: interaction.user,
      });

      if (!result.success) {
        return interaction.editReply({
          content: `❌ Couldn't create the escalation thread: ${result.error}`,
        });
      }

      await interaction.editReply({
        content: `✅ Escalation thread created: ${result.threadUrl}`,
      });
    } catch (err) {
      logger.error("Escalate context menu error:", err);
      await interaction.editReply({
        content:
          "❌ Something went wrong creating the escalation thread. Check the logs.",
      });
    }
  },
};