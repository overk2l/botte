require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  PermissionsBitField,
} = require("discord.js");

// Webhook management helper
async function getOrCreateWebhook(channel, name = "Role Menu Webhook") {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find(w => w.owner.id === channel.client.user.id);

  if (existing) return existing;
  return channel.createWebhook({
    name,
    avatar: channel.client.user.displayAvatarURL(),
    reason: "For role menus with custom branding"
  });
}

const db = {
  menus: new Map(),
  menuData: new Map(),
  createMenu(guildId, name, desc) {
    const id = Date.now().toString();
    if (!this.menus.has(guildId)) this.menus.set(guildId, []);
    this.menus.get(guildId).push(id);
    this.menuData.set(id, {
      guildId,
      name,
      desc,
      dropdownRoles: [],
      buttonRoles: [],
      selectionType: [],
      dropdownEmojis: {},
      buttonEmojis: {},
      regionalLimits: {},
      exclusionMap: {},
      maxRolesLimit: null,
      successMessageAdd: "✅ You now have the role <@&{roleId}>!",
      successMessageRemove: "✅ You removed the role <@&{roleId}>!",
      limitExceededMessage: "❌ You have reached the maximum number of roles for this menu or region.",
      dropdownRoleOrder: [],
      buttonRoleOrder: [],
      dropdownRoleDescriptions: {},
      channelId: null,
      messageId: null,
      enableDropdownClearRolesButton: true,
      enableButtonClearRolesButton: true,
      // New webhook properties
      useWebhook: false,
      webhookName: null,
      webhookAvatar: null,
      // Embed Customization Fields
      embedColor: null,
      embedThumbnail: null,
      embedImage: null,
      embedAuthorName: null,
      embedAuthorIconURL: null,
      embedFooterText: null,
      embedFooterIconURL: null,
    });
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map((id) => ({ id, ...this.menuData.get(id) }));
  },
  saveRoles(menuId, roles, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    if (type === "dropdown") menu.dropdownRoles = roles;
    if (type === "button") menu.buttonRoles = roles;
  },
  saveSelectionType(menuId, types) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.selectionType = types;
  },
  saveEmojis(menuId, emojis, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    if (type === "dropdown") {
      menu.dropdownEmojis = { ...menu.dropdownEmojis, ...emojis };
    } else if (type === "button") {
      menu.buttonEmojis = { ...menu.buttonEmojis, ...emojis };
    }
  },
  saveRegionalLimits(menuId, regionalLimits) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.regionalLimits = regionalLimits;
  },
  saveExclusionMap(menuId, exclusionMap) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.exclusionMap = exclusionMap;
  },
  saveMaxRolesLimit(menuId, limit) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.maxRolesLimit = limit;
  },
  saveCustomMessages(menuId, messages) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    Object.assign(menu, messages);
  },
  saveRoleOrder(menuId, order, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    if (type === "dropdown") menu.dropdownRoleOrder = order;
    if (type === "button") menu.buttonRoleOrder = order;
  },
  saveRoleDescriptions(menuId, descriptions) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    Object.assign(menu.dropdownRoleDescriptions, descriptions);
  },
  saveEmbedCustomization(menuId, embedSettings) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    Object.assign(menu, embedSettings);
  },
  saveEnableDropdownClearRolesButton(menuId, enabled) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.enableDropdownClearRolesButton = enabled;
  },
  saveEnableButtonClearRolesButton(menuId, enabled) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.enableButtonClearRolesButton = enabled;
  },
  getMenu(menuId) {
    return this.menuData.get(menuId);
  },
  saveMessageId(menuId, channelId, messageId) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.channelId = channelId;
    menu.messageId = messageId;
  },
  clearMessageId(menuId) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.channelId = null;
    menu.messageId = null;
  },
  // New webhook settings saving method
  saveWebhookSettings(menuId, settings) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    Object.assign(menu, settings);
  },
};

// Helper function to parse emoji strings for Discord components
function parseEmoji(emoji) {
  if (!emoji) return null;

  const customEmojiRegex = /^<a?:([a-zA-Z0-9_]+):(\d+)>$/;
  const match = emoji.match(customEmojiRegex);

  if (match) {
    return {
      id: match[2],
      name: match[1],
      animated: emoji.startsWith("<a:"),
    };
  }

  return { name: emoji };
}

// Helper function to check regional limits
function checkRegionalLimits(member, menu, newRoleIds) {
  const memberRoles = member.roles.cache;
  const violations = [];

  for (const [regionName, regionData] of Object.entries(menu.regionalLimits)) {
    const { limit, roleIds } = regionData;
    if (!limit || !roleIds || !roleIds.length) continue;

    const newRegionRoles = roleIds.filter(roleId => newRoleIds.includes(roleId));

    if (newRegionRoles.length > limit) {
      violations.push(`You can only select ${limit} role(s) from the ${regionName} region.`);
    }
  }

  return violations;
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildWebhooks, // Added for webhook management
  ],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST().setToken(process.env.TOKEN);
  const cmd = new SlashCommandBuilder().setName("dashboard").setDescription("Open the guild dashboard").toJSON();
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
  console.log(" /dashboard command deployed");
});

client.on("interactionCreate", async (interaction) => {
  try {
    // 1. Dashboard Permissions Check
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: "❌ You need Administrator permissions to use the dashboard.", ephemeral: true });
      }
      return sendMainDashboard(interaction);
    }

    if (interaction.isButton()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const extra = parts[2];
      const menuId = parts[3];

      if (ctx === "dash") {
        if (action === "reaction-roles") return showReactionRolesDashboard(interaction);
        if (action === "back") return sendMainDashboard(interaction);
      }

      if (ctx === "rr") {
        // All dashboard-related buttons should also have a permission check
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        if (action === "create") {
          const modal = new ModalBuilder()
            .setCustomId("rr:modal:create")
            .setTitle("New Reaction Role Menu")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("name").setLabel("Menu Name").setStyle(TextInputStyle.Short)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("desc").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "publish") {
          const targetMenuId = extra;
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing for publish.", ephemeral: true });
          return publishMenu(interaction, targetMenuId);
        }

        if (action === "edit_published") {
            const targetMenuId = extra;
            if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
            const menu = db.getMenu(targetMenuId);
            if (!menu || !menu.channelId || !menu.messageId) {
                return interaction.reply({ content: "❌ No published message found for this menu to edit.", ephemeral: true });
            }
            const channel = interaction.guild.channels.cache.get(menu.channelId);
            if (!channel) return interaction.reply({ content: "❌ Published channel not found.", ephemeral: true });

            try {
                const message = await channel.messages.fetch(menu.messageId);
                return publishMenu(interaction, targetMenuId, message);
            } catch (error) {
                console.error("Error fetching message to edit:", error);
                return interaction.reply({ content: "❌ Failed to fetch published message. It might have been deleted manually.", ephemeral: true });
            }
        }

        if (action === "delete_published") {
            const targetMenuId = extra;
            if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
            const menu = db.getMenu(targetMenuId);
            if (!menu || !menu.channelId || !menu.messageId) {
                return interaction.reply({ content: "❌ No published message found for this menu to delete.", ephemeral: true });
            }

            const confirmButton = new ButtonBuilder()
                .setCustomId(`rr:confirm_delete_published:${targetMenuId}`)
                .setLabel("Confirm Delete")
                .setStyle(ButtonStyle.Danger);
            const cancelButton = new ButtonBuilder()
                .setCustomId(`rr:cancel_delete_published:${targetMenuId}`)
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            return interaction.reply({
                content: "⚠️ Are you sure you want to delete the published reaction role message? This cannot be undone.",
                components: [row],
                ephemeral: true
            });
        }

        if (action === "confirm_delete_published") {
            const targetMenuId = extra;
            const menu = db.getMenu(targetMenuId);
            if (!menu || !menu.channelId || !menu.messageId) {
                return interaction.update({ content: "❌ No published message found or already deleted.", components: [], ephemeral: true });
            }
            const channel = interaction.guild.channels.cache.get(menu.channelId);
            if (!channel) {
                db.clearMessageId(targetMenuId);
                return interaction.update({ content: "❌ Published channel not found. Message ID cleared.", components: [], ephemeral: true });
            }

            try {
                const message = await channel.messages.fetch(menu.messageId);
                await message.delete();
                db.clearMessageId(targetMenuId);
                await interaction.update({ content: "✅ Published reaction role message deleted successfully!", components: [], ephemeral: true });
                return showMenuConfiguration(interaction, targetMenuId);
            } catch (error) {
                console.error("Error deleting message:", error);
                db.clearMessageId(targetMenuId);
                return interaction.update({ content: "❌ Failed to delete published message. It might have been deleted manually or bot lacks permissions. Message ID cleared.", ephemeral: true });
            }
        }

        if (action === "cancel_delete_published") {
            const targetMenuId = extra;
            return interaction.update({ content: "Deletion cancelled.", components: [], ephemeral: true });
        }

        if (action === "type") {
          const targetMenuId = menuId;
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing for selection type.", ephemeral: true });
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(targetMenuId, selectedTypes);

          const nextType = selectedTypes.includes("dropdown") ? "dropdown" : "button";
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${nextType}:${targetMenuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.update({
            content: `✅ Selection type saved. Now select roles for **${nextType}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }

        if (action === "addemoji") {
          const targetMenuId = menuId;
          if (!targetMenuId || !extra) return interaction.reply({ content: "Menu ID or type missing.", ephemeral: true });
          const menu = db.getMenu(targetMenuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const type = extra;
          const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
          if (!roles.length) return interaction.reply({ content: `No roles found for ${type}.`, ephemeral: true });

          const modal = new ModalBuilder().setCustomId(`rr:modal:addemoji:${type}:${targetMenuId}`).setTitle(`Add Emojis for ${type}`);

          const maxInputs = Math.min(roles.length, 5);
          for (let i = 0; i < maxInputs; i++) {
            const roleId = roles[i];
            const role = interaction.guild.roles.cache.get(roleId);
            const currentEmoji = type === "dropdown" ? menu.dropdownEmojis[roleId] : menu.buttonEmojis[roleId];
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(roleId)
                  .setLabel(`Emoji for ${role ? role.name : "Unknown Role"}`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("Enter emoji (🔥 or <:name:id>)")
                  .setValue(currentEmoji || "")
              )
            );
          }
          return interaction.showModal(modal);
        }

        if (action === "setlimits") {
          const targetMenuId = extra;
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(targetMenuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setlimits:${targetMenuId}`)
            .setTitle("Set Regional Role Limits & Max Roles")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("au_limit")
                  .setLabel("Limit For AU Roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits.AU?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("eu_limit")
                  .setLabel("Limit For EU Roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits.EU?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("na_limit")
                  .setLabel("Limit For NA Roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits.NA?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("regional_role_assignments")
                  .setLabel("Regional Role Assignments (JSON)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('{"AU": ["roleId1"], "EU": ["roleId2"], "NA": ["roleId3"]}')
                  .setRequired(false)
                  .setValue(JSON.stringify(Object.fromEntries(
                    Object.entries(menu.regionalLimits).map(([region, data]) => [region, data.roleIds || []])
                  )) || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("max_roles_limit")
                  .setLabel("Max Roles Per Menu (0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("0")
                  .setValue(menu.maxRolesLimit !== null ? menu.maxRolesLimit.toString() : "")
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "setexclusions") {
          const targetMenuId = extra;
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(targetMenuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          if (!allRoles.size) return interaction.reply({ content: "No roles available to set exclusions.", ephemeral: true });

          const selectTriggerRole = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_trigger_role:${targetMenuId}`)
            .setPlaceholder("Select a role to set its exclusions...")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.update({
            content: "Please select the role that, when picked, should remove other roles:",
            components: [new ActionRowBuilder().addComponents(selectTriggerRole)],
            ephemeral: true
          });
        }

        if (action === "customize_embed") {
          const targetMenuId = extra;
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(targetMenuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:customize_embed:${targetMenuId}`)
            .setTitle("Customize Embed Appearance")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("embed_color")
                  .setLabel("Embed Color (Hex Code, e.g., #FF0000)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("#5865F2")
                  .setValue(menu.embedColor || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("thumbnail_url")
                  .setLabel("Thumbnail Image URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/thumbnail.png")
                  .setValue(menu.embedThumbnail || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("image_url")
                  .setLabel("Main Image URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/image.png")
                  .setValue(menu.embedImage || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("author_name")
                  .setLabel("Author Name (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("My Awesome Bot")
                  .setValue(menu.embedAuthorName || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("author_icon_url")
                  .setLabel("Author Icon URL (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/author_icon.png")
                  .setValue(menu.embedAuthorIconURL || "")
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "customize_footer") {
          const targetMenuId = extra;
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(targetMenuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:customize_footer:${targetMenuId}`)
            .setTitle("Customize Embed Footer")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("footer_text")
                  .setLabel("Footer Text")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("Select your roles below!")
                  .setValue(menu.embedFooterText || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("footer_icon_url")
                  .setLabel("Footer Icon URL (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/footer_icon.png")
                  .setValue(menu.embedFooterIconURL || "")
              )
            );
          return interaction.showModal(modal);
        }

        // New webhook toggle button handler
        if (action === "toggle_webhook") {
          const targetMenuId = extra;
          const menu = db.getMenu(targetMenuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const newState = !menu.useWebhook;
          db.saveWebhookSettings(targetMenuId, { useWebhook: newState });

          await interaction.reply({
            content: `✅ Webhook sending is now ${newState ? "ENABLED" : "DISABLED"}`,
            ephemeral: true
          });
          return showMenuConfiguration(interaction, targetMenuId); // Refresh the menu config view
        }

        // Webhook branding configuration handler
        if (action === "config_webhook") {
          const targetMenuId = extra;
          const menu = db.getMenu(targetMenuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:webhook_branding:${targetMenuId}`)
            .setTitle("Webhook Branding Settings")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("name")
                  .setLabel("Display Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(menu.webhookName || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("avatar")
                  .setLabel("Avatar URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(menu.webhookAvatar || "")
              )
            );
          return interaction.showModal(modal);
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const type = parts[2];
      const menuId = parts[3];

      if (ctx === "rr") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        if (action === "selectmenu") {
          const targetMenuId = interaction.values[0];
          console.log(`[Interaction] Selected menu: ${targetMenuId}`);
          return showMenuConfiguration(interaction, targetMenuId);
        }

        if (action === "selectroles") {
          const selectedRoleIds = interaction.values;
          db.saveRoles(menuId, selectedRoleIds, type);
          await interaction.update({
            content: `✅ Roles saved for ${type}.`,
            components: []
          });
          return showMenuConfiguration(interaction, menuId); // Show menu configuration after saving roles
        }

        if (action === "reorder_dropdown" || action === "reorder_button") {
          const currentOrder = interaction.values;
          const type = action.split("_")[1]; // "dropdown" or "button"
          db.saveRoleOrder(menuId, currentOrder, type);
          await interaction.update({ content: `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} role order saved!`, components: [] });
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "select_trigger_role") {
          const triggerRoleId = interaction.values[0];
          const menu = db.getMenu(menuId);
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id && r.id !== triggerRoleId);

          if (!allRoles.size) {
            return interaction.update({ content: "No other roles available to set as exclusions for this trigger role.", components: [], ephemeral: true });
          }

          const selectExclusionRoles = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_exclusion_roles:${triggerRoleId}:${menuId}`)
            .setPlaceholder(`Select roles to exclude when ${interaction.guild.roles.cache.get(triggerRoleId).name} is picked...`)
            .setMinValues(0)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({
              label: r.name,
              value: r.id,
              default: (menu.exclusionMap[triggerRoleId] || []).includes(r.id)
            })));

          return interaction.update({
            content: `Now select roles to be **removed** when <@&${triggerRoleId}> is added:`,
            components: [new ActionRowBuilder().addComponents(selectExclusionRoles)],
            ephemeral: true
          });
        }

        if (action === "select_exclusion_roles") {
          const triggerRoleId = type; // The role that triggers the exclusion
          const exclusionRoleIds = interaction.values; // The roles to be excluded

          const menu = db.getMenu(menuId);
          const newExclusionMap = { ...menu.exclusionMap, [triggerRoleId]: exclusionRoleIds };
          db.saveExclusionMap(menuId, newExclusionMap);

          await interaction.update({ content: "✅ Exclusion roles saved!", components: [], ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "set_role_descriptions") {
          const roleId = interaction.values[0];
          const menu = db.getMenu(menuId);
          const currentDescription = menu.dropdownRoleDescriptions[roleId] || "";
          const roleName = interaction.guild.roles.cache.get(roleId)?.name || "Unknown Role";

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:role_description:${menuId}:${roleId}`)
            .setTitle(`Set Description for ${roleName}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("description_input")
                  .setLabel("Role Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("A short description for this role.")
                  .setValue(currentDescription)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "toggle_dropdown_clear_button") {
          const newState = interaction.values[0] === 'true';
          db.saveEnableDropdownClearRolesButton(menuId, newState);
          await interaction.update({ content: `✅ Dropdown "Clear Roles" button is now ${newState ? "ENABLED" : "DISABLED"}.`, components: [], ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "toggle_button_clear_button") {
          const newState = interaction.values[0] === 'true';
          db.saveEnableButtonClearRolesButton(menuId, newState);
          await interaction.update({ content: `✅ Button "Clear Roles" button is now ${newState ? "ENABLED" : "DISABLED"}.`, components: [], ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const extra = parts[2]; // This is often the menuId or a type

      if (ctx === "rr") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        // Defer the modal submission interaction *before* calling showMenuConfiguration
        // This ensures the interaction is acknowledged and can be edited later.
        await interaction.deferUpdate();

        if (action === "modal") {
          if (extra === "create") {
            const name = interaction.fields.getTextInputValue("name");
            const desc = interaction.fields.getTextInputValue("desc");
            const newMenuId = db.createMenu(interaction.guild.id, name, desc);
            // showMenuConfiguration will now edit the deferred reply
            return showMenuConfiguration(interaction, newMenuId);
          }
          if (extra === "addemoji") {
            const type = parts[3];
            const menuId = parts[4];
            const menu = db.getMenu(menuId);
            if (!menu) {
                return interaction.followUp({ content: "Menu not found.", ephemeral: true });
            }

            const newEmojis = {};
            const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
            for (const roleId of roles) {
              const emojiInput = interaction.fields.getTextInputValue(roleId);
              if (emojiInput) {
                newEmojis[roleId] = emojiInput;
              } else {
                delete newEmojis[roleId]; // Remove if empty
              }
            }
            db.saveEmojis(menuId, newEmojis, type);
            return showMenuConfiguration(interaction, menuId);
          }
          if (extra === "setlimits") {
            const menuId = parts[3];
            const menu = db.getMenu(menuId);
            if (!menu) {
                return interaction.followUp({ content: "Menu not found.", ephemeral: true });
            }

            const auLimit = parseInt(interaction.fields.getTextInputValue("au_limit"));
            const euLimit = parseInt(interaction.fields.getTextInputValue("eu_limit"));
            const naLimit = parseInt(interaction.fields.getTextInputValue("na_limit"));
            const regionalRoleAssignmentsRaw = interaction.fields.getTextInputValue("regional_role_assignments");
            const maxRolesLimitInput = interaction.fields.getTextInputValue("max_roles_limit");

            const newRegionalLimits = {};
            if (!isNaN(auLimit) && auLimit >= 0) newRegionalLimits.AU = { limit: auLimit };
            if (!isNaN(euLimit) && euLimit >= 0) newRegionalLimits.EU = { limit: euLimit };
            if (!isNaN(naLimit) && naLimit >= 0) newRegionalLimits.NA = { limit: naLimit };

            try {
              if (regionalRoleAssignmentsRaw) {
                const parsedAssignments = JSON.parse(regionalRoleAssignmentsRaw);
                for (const [region, roleIds] of Object.entries(parsedAssignments)) {
                  if (Array.isArray(roleIds)) {
                    if (newRegionalLimits[region]) {
                      newRegionalLimits[region].roleIds = roleIds;
                    } else {
                      newRegionalLimits[region] = { roleIds };
                    }
                  }
                }
              }
            } catch (jsonError) {
              return interaction.followUp({ content: "❌ Invalid JSON for Regional Role Assignments. Please check the format.", ephemeral: true });
            }

            db.saveRegionalLimits(menuId, newRegionalLimits);

            let maxRolesLimit = null;
            if (maxRolesLimitInput) {
              const parsedLimit = parseInt(maxRolesLimitInput);
              if (!isNaN(parsedLimit) && parsedLimit >= 0) {
                maxRolesLimit = parsedLimit;
              } else {
                return interaction.followUp({ content: "❌ Invalid value for Max Roles Per Menu. Please enter a number.", ephemeral: true });
              }
            }
            db.saveMaxRolesLimit(menuId, maxRolesLimit);
            return showMenuConfiguration(interaction, menuId);
          }

          if (extra === "customize_embed") {
            const menuId = parts[3];
            const menu = db.getMenu(menuId);
            if (!menu) {
                return interaction.followUp({ content: "Menu not found.", ephemeral: true });
            }

            const embedColor = interaction.fields.getTextInputValue("embed_color") || null;
            const embedThumbnail = interaction.fields.getTextInputValue("thumbnail_url") || null;
            const embedImage = interaction.fields.getTextInputValue("image_url") || null;
            const embedAuthorName = interaction.fields.getTextInputValue("author_name") || null;
            const embedAuthorIconURL = interaction.fields.getTextInputValue("author_icon_url") || null;

            db.saveEmbedCustomization(menuId, {
              embedColor,
              embedThumbnail,
              embedImage,
              embedAuthorName,
              embedAuthorIconURL,
            });
            return showMenuConfiguration(interaction, menuId);
          }

          if (extra === "customize_footer") {
            const menuId = parts[3];
            const menu = db.getMenu(menuId);
            if (!menu) {
                return interaction.followUp({ content: "Menu not found.", ephemeral: true });
            }

            const footerText = interaction.fields.getTextInputValue("footer_text") || null;
            const footerIconURL = interaction.fields.getTextInputValue("footer_icon_url") || null;

            db.saveEmbedCustomization(menuId, {
              embedFooterText: footerText,
              embedFooterIconURL: footerIconURL,
            });
            return showMenuConfiguration(interaction, menuId);
          }
          if (extra === "custom_messages") {
            const menuId = parts[3];
            const menu = db.getMenu(menuId);
            if (!menu) {
                return interaction.followUp({ content: "Menu not found.", ephemeral: true });
            }

            const successAdd = interaction.fields.getTextInputValue("success_add_message") || null;
            const successRemove = interaction.fields.getTextInputValue("success_remove_message") || null;
            const limitExceeded = interaction.fields.getTextInputValue("limit_exceeded_message") || null;

            db.saveCustomMessages(menuId, {
              successMessageAdd: successAdd || "✅ You now have the role <@&{roleId}>!",
              successMessageRemove: successRemove || "✅ You removed the role <@&{roleId}>!",
              limitExceededMessage: limitExceeded || "❌ You have reached the maximum number of roles for this menu or region.",
            });
            return showMenuConfiguration(interaction, menuId);
          }

          if (extra === "role_description") {
            const menuId = parts[3];
            const roleId = parts[4];
            const description = interaction.fields.getTextInputValue("description_input");
            db.saveRoleDescriptions(menuId, { [roleId]: description || null });
            return showMenuConfiguration(interaction, menuId);
          }

          // Handle webhook branding modal
          if (extra === "webhook_branding") {
            const menuId = parts[3];
            const menu = db.getMenu(menuId);
            if (!menu) {
                return interaction.followUp({ content: "Menu not found.", ephemeral: true });
            }

            const name = interaction.fields.getTextInputValue("name");
            const avatar = interaction.fields.getTextInputValue("avatar");

            db.saveWebhookSettings(menuId, {
              webhookName: name || null,
              webhookAvatar: avatar || null
            });
            return showMenuConfiguration(interaction, menuId); // Refresh the menu config view
          }
        }
      }
    }

    // Role adding/removing on select menu or button press
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr-role-select:") || interaction.isButton() && interaction.customId.startsWith("rr-role-button:")) {
        const menuId = interaction.customId.split(":")[1];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "❌ This reaction role menu is no longer valid.", ephemeral: true });

        const selectedRoleIds = interaction.isStringSelectMenu() ? interaction.values : [interaction.customId.split(":")[2]];

        let rolesToAdd = [];
        let rolesToRemove = [];
        let messages = [];

        // Handle exclusions first
        for (const roleId of selectedRoleIds) {
          const exclusions = menu.exclusionMap[roleId];
          if (exclusions && exclusions.length > 0) {
            for (const excludedRoleId of exclusions) {
              if (interaction.member.roles.cache.has(excludedRoleId)) {
                rolesToRemove.push(excludedRoleId);
                messages.push(`Removed <@&${excludedRoleId}> due to exclusion.`);
              }
            }
          }
        }

        // Apply new roles and check limits
        const currentMenuRoles = (menu.dropdownRoles || []).concat(menu.buttonRoles || []);
        const memberRolesFromThisMenu = interaction.member.roles.cache.filter(role => currentMenuRoles.includes(role.id));
        const newRolesCount = selectedRoleIds.filter(roleId => !memberRolesFromThisMenu.has(roleId)).length;
        const totalRolesAfterAdd = memberRolesFromThisMenu.size + newRolesCount - rolesToRemove.length; // Approximate total after exclusions

        // Check max roles limit
        if (menu.maxRolesLimit !== null && menu.maxRolesLimit > 0 && totalRolesAfterAdd > menu.maxRolesLimit) {
            return interaction.reply({ content: menu.limitExceededMessage, ephemeral: true });
        }

        // Check regional limits
        const currentMemberRoleIds = interaction.member.roles.cache.map(r => r.id);
        const rolesToBeAddedFinal = selectedRoleIds.filter(roleId => !currentMemberRoleIds.includes(roleId) && !rolesToRemove.includes(roleId));
        const combinedRolesForLimitCheck = [...currentMemberRoleIds.filter(id => !rolesToRemove.includes(id)), ...rolesToBeAddedFinal];

        const regionalViolations = checkRegionalLimits(interaction.member, menu, combinedRolesForLimitCheck);
        if (regionalViolations.length > 0) {
            return interaction.reply({ content: regionalViolations.join("\n"), ephemeral: true });
        }

        for (const roleId of selectedRoleIds) {
          if (interaction.member.roles.cache.has(roleId)) {
            // Role exists, remove it
            if (!rolesToRemove.includes(roleId)) { // Don't add to remove if already marked by exclusion
              rolesToRemove.push(roleId);
              messages.push(menu.successMessageRemove.replace("{roleId}", roleId));
            }
          } else {
            // Role doesn't exist, add it
            if (!rolesToAdd.includes(roleId)) { // Don't add to add if it's going to be removed by exclusion
              rolesToAdd.push(roleId);
              messages.push(menu.successMessageAdd.replace("{roleId}", roleId));
            }
          }
        }

        try {
          if (rolesToAdd.length > 0) {
            await interaction.member.roles.add(rolesToAdd);
          }
          if (rolesToRemove.length > 0) {
            await interaction.member.roles.remove(rolesToRemove);
          }

          if (messages.length > 0) {
            await interaction.reply({ content: messages.join("\n"), ephemeral: true });
          } else {
            await interaction.reply({ content: "No changes made to your roles.", ephemeral: true });
          }
        } catch (error) {
          console.error("Error updating roles:", error);
          if (error.code === 50013) {
              await interaction.reply({ content: "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.", ephemeral: true });
          } else {
              await interaction.reply({ content: "❌ There was an error updating your roles.", ephemeral: true });
          }
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("rr-clear-roles:")) {
      const menuId = interaction.customId.split(":")[1];
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "❌ This reaction role menu is no longer valid.", ephemeral: true });

      const allMenuRoleIds = [...menu.dropdownRoles, ...menu.buttonRoles];
      const rolesToRemove = interaction.member.roles.cache.filter(role => allMenuRoleIds.includes(role.id)).map(role => role.id);

      if (rolesToRemove.length === 0) {
        return interaction.reply({ content: "You don't have any roles from this menu to clear.", ephemeral: true });
      }

      try {
        await interaction.member.roles.remove(rolesToRemove);
        await interaction.reply({ content: "✅ All roles from this menu have been cleared.", ephemeral: true });
      } catch (error) {
        console.error("Error clearing roles:", error);
        if (error.code === 50013) {
            await interaction.reply({ content: "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.", ephemeral: true });
        } else {
            await interaction.reply({ content: "❌ There was an error clearing your roles.", ephemeral: ephemeral: true });
        }
      }
    }

  } catch (error) {
    console.error("Error handling interaction:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
    }
  }
});

// --- Dashboard Functions ---

async function sendMainDashboard(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("Bot Dashboard")
    .setDescription("Welcome to the bot dashboard! Use the buttons below to manage different features.")
    .setColor("#5865F2");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dash:reaction-roles")
      .setLabel("Reaction Roles")
      .setStyle(ButtonStyle.Primary)
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function showReactionRolesDashboard(interaction) {
  console.log("[showReactionRolesDashboard] Function called.");
  const menus = db.getMenus(interaction.guild.id);
  console.log(`[showReactionRolesDashboard] Found ${menus.length} menus.`);

  const embed = new EmbedBuilder()
    .setTitle("Reaction Role Menus")
    .setDescription("Manage your reaction role menus here. Create new ones or configure existing.")
    .setColor("#5865F2");

  const components = [];

  // Only add the select menu if there are existing menus
  if (menus.length > 0) {
    const menuOptions = menus.map((menu) => ({ label: menu.name, value: menu.id }));
    console.log(`[showReactionRolesDashboard] Generated ${menuOptions.length} select menu options.`);
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("rr:selectmenu")
      .setPlaceholder("Select a menu to configure...")
      .addOptions(menuOptions);
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  } else {
    embed.setDescription("No reaction role menus found. Create a new one!");
    console.log("[showReactionRolesDashboard] No menus found, omitting select menu.");
  }

  const createButton = new ButtonBuilder()
    .setCustomId("rr:create")
    .setLabel("Create New Menu")
    .setStyle(ButtonStyle.Success);

  const backButton = new ButtonBuilder()
    .setCustomId("dash:back")
    .setLabel("Back to Dashboard")
    .setStyle(ButtonStyle.Secondary);

  components.push(new ActionRowBuilder().addComponents(createButton, backButton));

  try {
    console.log(`[showReactionRolesDashboard] Attempting to update interaction with ${components.length} components.`);
    await interaction.update({ embeds: [embed], components, ephemeral: true });
    console.log("[showReactionRolesDashboard] Interaction updated successfully.");
  } catch (error) {
    console.error("[showReactionRolesDashboard] Error updating interaction:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong while displaying the reaction roles dashboard.", ephemeral: true });
    }
  }
}

async function showMenuConfiguration(interaction, menuId) {
  console.log(`[showMenuConfiguration] Function called for menuId: ${menuId}`);
  const menu = db.getMenu(menuId);
  if (!menu) {
    console.error(`[showMenuConfiguration] Menu not found for ID: ${menuId}`);
    // If interaction is already replied/deferred, use followUp, otherwise reply.
    if (interaction.replied || interaction.deferred) {
        return interaction.followUp({ content: "Menu not found.", ephemeral: true }).catch(e => console.error("Error sending followUp:", e));
    }
    return interaction.reply({ content: "Menu not found.", ephemeral: true });
  }
  console.log(`[showMenuConfiguration] Menu data retrieved for ${menu.name}.`);

  const embed = new EmbedBuilder()
    .setTitle(`Configuring: ${menu.name}`)
    .setDescription(menu.desc)
    .addFields(
      { name: "Menu ID", value: `\`${menu.id}\``, inline: true },
      { name: "Dropdown Roles", value: menu.dropdownRoles.length > 0 ? menu.dropdownRoles.map((r) => `<@&${r}>`).join(", ") : "None", inline: false },
      { name: "Button Roles", value: menu.buttonRoles.length > 0 ? menu.buttonRoles.map((r) => `<@&${r}>`).join(", ") : "None", inline: false },
      { name: "Selection Type", value: menu.selectionType.join(" & ") || "Not set", inline: true },
      { name: "Published", value: menu.messageId ? `✅ Yes in <#${menu.channelId}>` : "❌ No", inline: true },
    )
    .setColor(menu.embedColor || "#5865F2");

  if (menu.embedThumbnail) embed.setThumbnail(menu.embedThumbnail);
  if (menu.embedImage) embed.setImage(menu.embedImage);
  if (menu.embedAuthorName) {
    embed.setAuthor({
      name: menu.embedAuthorName,
      iconURL: menu.embedAuthorIconURL || undefined
    });
  }
  if (menu.embedFooterText) {
    embed.setFooter({
      text: menu.embedFooterText,
      iconURL: menu.embedFooterIconURL || undefined
    });
  }

  // Add webhook status to embed
  embed.addFields(
    {
      name: "Webhook Sending",
      value: menu.useWebhook ? "✅ Enabled" : "❌ Disabled",
      inline: true
    },
    {
      name: "Webhook Branding",
      value: menu.webhookName
        ? `Name: ${menu.webhookName}\n${menu.webhookAvatar ? "Custom Avatar" : "Default Avatar"}`
        : "Not configured",
      inline: true
    }
  );


  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:type:dropdown:${menuId}`)
      .setLabel("Set Dropdown Roles")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(menu.selectionType.length > 0 && !menu.selectionType.includes("dropdown")),
    new ButtonBuilder()
      .setCustomId(`rr:type:button:${menuId}`)
      .setLabel("Set Button Roles")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(menu.selectionType.length > 0 && !menu.selectionType.includes("button")),
    new ButtonBuilder()
      .setCustomId(`rr:type:both:${menuId}`)
      .setLabel("Set Both Types")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(menu.selectionType.length === 2),
    new ButtonBuilder()
      .setCustomId(`rr:addemoji:dropdown:${menuId}`)
      .setLabel("Add Dropdown Emojis")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!menu.dropdownRoles.length),
    new ButtonBuilder()
      .setCustomId(`rr:addemoji:button:${menuId}`)
      .setLabel("Add Button Emojis")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!menu.buttonRoles.length)
  );
  console.log("[showMenuConfiguration] row created.");

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:setlimits:${menuId}`)
      .setLabel("Set Regional Limits & Max Roles")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:setexclusions:${menuId}`)
      .setLabel("Set Role Exclusions")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:customize_embed:${menuId}`)
      .setLabel("Customize Embed")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:customize_footer:${menuId}`)
      .setLabel("Customize Footer")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:custom_messages:${menuId}`)
      .setLabel("Custom Messages")
      .setStyle(ButtonStyle.Primary)
  );
  console.log("[showMenuConfiguration] row2 created.");

  const reorderDropdownButton = new ButtonBuilder()
    .setCustomId(`rr:reorder_dropdown:${menuId}`)
    .setLabel("Reorder Dropdown Roles")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(menu.dropdownRoles.length <= 1);

  const reorderButtonButton = new ButtonBuilder()
    .setCustomId(`rr:reorder_button:${menuId}`)
    .setLabel("Reorder Button Roles")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(menu.buttonRoles.length <= 1);

  const setDescriptionsButton = new ButtonBuilder()
    .setCustomId(`rr:set_role_descriptions:${menuId}`)
    .setLabel("Set Role Descriptions")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!menu.dropdownRoles.length);

  const toggleDropdownClearButton = new StringSelectMenuBuilder()
    .setCustomId(`rr:toggle_dropdown_clear_button:${menuId}`)
    .setPlaceholder("Toggle Dropdown Clear Button")
    .addOptions([
      { label: "Enable", value: "true", default: menu.enableDropdownClearRolesButton },
      { label: "Disable", value: "false", default: !menu.enableDropdownClearRolesButton },
    ]);

  const toggleButtonClearButton = new StringSelectMenuBuilder()
    .setCustomId(`rr:toggle_button_clear_button:${menuId}`)
    .setPlaceholder("Toggle Button Clear Button")
    .addOptions([
      { label: "Enable", value: "true", default: menu.enableButtonClearRolesButton },
      { label: "Disable", value: "false", default: !menu.enableButtonClearRolesButton },
    ]);

  const row3 = new ActionRowBuilder().addComponents(reorderDropdownButton, reorderButtonButton, setDescriptionsButton);
  const row3_5_dropdown = new ActionRowBuilder().addComponents(toggleDropdownClearButton);
  const row3_5_button = new ActionRowBuilder().addComponents(toggleButtonClearButton);
  console.log("[showMenuConfiguration] row3, row3_5_dropdown, row3_5_button created.");


  // Add webhook control buttons
  const webhookRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:toggle_webhook:${menuId}`)
      .setLabel(menu.useWebhook ? "Disable Webhook" : "Enable Webhook")
      .setStyle(menu.useWebhook ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rr:config_webhook:${menuId}`)
      .setLabel("Configure Branding")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!menu.useWebhook)
  );
  console.log("[showMenuConfiguration] webhookRow created.");


  const publishButton = new ButtonBuilder()
    .setCustomId(`rr:publish:${menuId}`)
    .setLabel("Publish Menu")
    .setStyle(ButtonStyle.Success)
    .setDisabled(!menu.selectionType.length || (!menu.dropdownRoles.length && !menu.buttonRoles.length)); // Disable if no roles are set

  const editPublishedButton = new ButtonBuilder()
    .setCustomId(`rr:edit_published:${menuId}`)
    .setLabel("Update Published Menu")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!menu.messageId); // Disable if not already published

  const deletePublishedButton = new ButtonBuilder()
    .setCustomId(`rr:delete_published:${menuId}`)
    .setLabel("Delete Published Menu")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!menu.messageId); // Disable if not already published

  const backToRRButton = new ButtonBuilder()
    .setCustomId("dash:reaction-roles")
    .setLabel("Back to RR Dashboard")
    .setStyle(ButtonStyle.Secondary);

  const row4 = new ActionRowBuilder().addComponents(publishButton, editPublishedButton, deletePublishedButton, backToRRButton);
  console.log("[showMenuConfiguration] row4 created.");

  const components = [row, row2, row3, row3_5_dropdown, row3_5_button, webhookRow, row4];
  console.log(`[showMenuConfiguration] Total components to send: ${components.length}.`);

  try {
    if (interaction.replied || interaction.deferred) {
      console.log("[showMenuConfiguration] Interaction already replied/deferred, attempting to editReply.");
      await interaction.editReply({ embeds: [embed], components, ephemeral: true });
    } else {
      console.log("[showMenuConfiguration] Interaction not replied/deferred, attempting to update/reply.");
      // For buttons/select menus, use update. For slash commands, use reply.
      // If none of these, defer and then editReply.
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
          await interaction.update({ embeds: [embed], components, ephemeral: true });
      } else if (interaction.isChatInputCommand()) {
          await interaction.reply({ embeds: [embed], components, ephemeral: true });
      } else {
          // Fallback, should ideally not be hit if interaction flow is managed correctly
          await interaction.deferReply({ ephemeral: true });
          await interaction.editReply({ embeds: [embed], components, ephemeral: true });
      }
    }
    console.log("[showMenuConfiguration] Interaction response sent successfully.");
  } catch (error) {
    console.error("[showMenuConfiguration] Error during interaction response:", error);
    if (error.code === 10062) { // Unknown interaction
        console.error("This often means the interaction token expired (3 seconds).");
        await interaction.followUp({ content: "❌ It took too long to respond. Please try again.", ephemeral: true }).catch(e => console.error("Error sending followUp:", e));
    } else if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong while displaying the menu configuration.", ephemeral: true });
    } else {
        // If already replied/deferred, try followUp as a last resort for error message
        await interaction.followUp({ content: "❌ An error occurred after initial response. Please check console.", ephemeral: true }).catch(e => console.error("Error sending followUp for error:", e));
    }
  }
}

async function publishMenu(interaction, menuId, messageToEdit = null) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle(menu.name)
    .setDescription(menu.desc)
    .setColor(menu.embedColor || "#5865F2");

  if (menu.embedThumbnail) embed.setThumbnail(menu.embedThumbnail);
  if (menu.embedImage) embed.setImage(menu.embedImage);
  if (menu.embedAuthorName) {
    embed.setAuthor({
      name: menu.embedAuthorName,
      iconURL: menu.embedAuthorIconURL || undefined
    });
  }
  if (menu.embedFooterText) {
    embed.setFooter({
      text: menu.embedFooterText,
      iconURL: menu.embedFooterIconURL || undefined
    });
  }

  const components = [];

  // Dropdown Select Menu
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length > 0) {
    const dropdownOptions = menu.dropdownRoleOrder.length > 0
      ? menu.dropdownRoleOrder.map(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        return {
          label: role.name,
          value: role.id,
          emoji: parseEmoji(menu.dropdownEmojis[role.id]),
          description: menu.dropdownRoleDescriptions[role.id] || undefined,
        };
      }).filter(Boolean)
      : menu.dropdownRoles.map(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        return {
          label: role.name,
          value: role.id,
          emoji: parseEmoji(menu.dropdownEmojis[role.id]),
          description: menu.dropdownRoleDescriptions[role.id] || undefined,
        };
      }).filter(Boolean);

    if (dropdownOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`rr-role-select:${menuId}`)
        .setPlaceholder("Select a role...")
        .setMinValues(0)
        .setMaxValues(dropdownOptions.length)
        .addOptions(dropdownOptions);
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }
  }

  // Clear dropdown roles button
  if (menu.selectionType.includes("dropdown") && menu.enableDropdownClearRolesButton) {
    const clearButton = new ButtonBuilder()
      .setCustomId(`rr-clear-roles:${menuId}:dropdown`)
      .setLabel("Clear All Dropdown Roles")
      .setStyle(ButtonStyle.Secondary);
    components.push(new ActionRowBuilder().addComponents(clearButton));
  }


  // Buttons
  if (menu.selectionType.includes("button") && menu.buttonRoles.length > 0) {
    const buttonRows = [];
    let currentRow = new ActionRowBuilder();
    const orderedButtonRoles = menu.buttonRoleOrder.length > 0
      ? menu.buttonRoleOrder
      : menu.buttonRoles;

    for (const roleId of orderedButtonRoles) {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) continue;

      const button = new ButtonBuilder()
        .setCustomId(`rr-role-button:${menuId}:${role.id}`)
        .setLabel(role.name)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(parseEmoji(menu.buttonEmojis[role.id]));

      if (currentRow.components.length < 5) {
        currentRow.addComponents(button);
      } else {
        buttonRows.push(currentRow);
        currentRow = new ActionRowBuilder().addComponents(button);
      }
    }
    if (currentRow.components.length > 0) {
      buttonRows.push(currentRow);
    }
    components.push(...buttonRows);
  }

  // Clear button roles button
  if (menu.selectionType.includes("button") && menu.enableButtonClearRolesButton) {
    const clearButton = new ButtonBuilder()
      .setCustomId(`rr-clear-roles:${menuId}:button`)
      .setLabel("Clear All Button Roles")
      .setStyle(ButtonStyle.Secondary);
    components.push(new ActionRowBuilder().addComponents(clearButton));
  }

  try {
    // Delete old message if exists and it's a fresh publish (not an edit)
    if (menu.messageId && !messageToEdit) {
      try {
        const oldChannel = interaction.guild.channels.cache.get(menu.channelId);
        if (oldChannel) {
          const oldMessage = await oldChannel.messages.fetch(menu.messageId);
          await oldMessage.delete();
        }
      } catch (error) {
        console.log("Couldn't delete old message, probably already deleted or not found.");
      }
    }

    let message;
    if (messageToEdit) {
      // Edit existing message
      if (menu.useWebhook) {
        const webhook = await getOrCreateWebhook(messageToEdit.channel);
        await webhook.editMessage(messageToEdit.id, {
          embeds: [embed],
          components,
          username: menu.webhookName || interaction.guild.me.displayName,
          avatarURL: menu.webhookAvatar || interaction.guild.me.displayAvatarURL(),
        });
        message = messageToEdit; // Keep the same message reference
      } else {
        message = await messageToEdit.edit({
          embeds: [embed],
          components
        });
      }
    } else if (menu.useWebhook) {
      // WEBHOOK MODE: Custom branding + functional components
      const webhook = await getOrCreateWebhook(interaction.channel);

      message = await webhook.send({
        embeds: [embed],
        components,
        username: menu.webhookName || interaction.guild.me.displayName,
        avatarURL: menu.webhookAvatar || interaction.guild.me.displayAvatarURL(),
      });
    } else {
      // REGULAR MODE: Standard bot message
      message = await interaction.channel.send({
        embeds: [embed],
        components
      });
    }

    db.saveMessageId(menuId, interaction.channel.id, message.id);
    await interaction.reply({
      content: `✅ Menu published successfully using ${menu.useWebhook ? "WEBHOOK" : "BOT"}!`,
      ephemeral: true
    });
  } catch (error) {
    console.error("Publishing error:", error);
    let errorMsg = "❌ Failed to publish menu. ";

    if (error.code === 50013) {
      errorMsg += "Bot lacks permissions. Required: 'Manage Webhooks' and 'Send Messages'";
    } else if (error.message.includes("ENOENT")) {
      errorMsg += "Invalid image URL or resource not found.";
    } else {
      errorMsg += error.message;
    }

    await interaction.reply({ content: errorMsg, ephemeral: true });
  }
}

client.login(process.env.TOKEN);
