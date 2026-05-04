const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
} = require("discord.js");
const escalationService = require("../../services/escalationService");
const logger = require("../../utils/logger");

/**
 * Creates a public thread under the targeted message in the same channel.
 * Most issues get resolved in this thread without ever leaving the
 * partner's channel. Only when something needs cross-team partner-escalations
 * attention does staff click the "Escalate to Partner Escalations" button
 * inside the triage thread to fan it out to the UDP server.
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName("Create Thread")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) // Coarse gate — the fine-grained role check is in escalationService.userIsAllowed.
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const targetMessage = interaction.targetMessage;

    try {
      const allowed = await escalationService.userIsAllowed(interaction.member);
      if (!allowed) {
        return interaction.editReply({
          content: "❌ You do not have permission to create threads.",
        });
      }

      const result = await escalationService.createTriageThread({
        client: interaction.client,
        targetMessage,
        triggeredBy: interaction.user,
      });

      if (!result.success) {
        return interaction.editReply({
          content: `❌ Couldn't create the thread: ${result.error}`,
        });
      }

      const verb = result.duplicate ? "Found existing" : "Created";
      await interaction.editReply({
        content: `✅ ${verb} thread: ${result.threadUrl}`,
      });
    } catch (err) {
      logger.error("Create thread error:", err);
      await interaction.editReply({
        content:
          "❌ Something went wrong creating the thread. Check the logs.",
      });
    }
  },
};
