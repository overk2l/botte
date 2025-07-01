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
  PermissionsBitField, // Import PermissionsBitField
} = require("discord.js");

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
      dropdownEmojis: {},    // key: roleId, value: emoji string
      buttonEmojis: {},       // key: roleId, value: emoji string
      regionalLimits: {},     // key: regionName, value: { limit: number, roleIds: [roleId1, roleId2] }
      exclusionMap: {},       // New: key: roleId to add, value: [roleId1 to remove, roleId2 to remove]
      maxRolesLimit: null,    // New: Max roles a user can have from this menu
      successMessageAdd: "✅ You now have the role <@&{roleId}>!", // New: Custom success message
      successMessageRemove: "✅ You removed the role <@&{roleId}>!", // New: Custom remove message
      limitExceededMessage: "❌ You have reached the maximum number of roles for this menu or region.", // New: Custom limit message
      dropdownRoleOrder: [], // New: Custom order for dropdown roles
      buttonRoleOrder: [],   // New: Custom order for button roles
      dropdownRoleDescriptions: {}, // New: Descriptions for dropdown roles
      roleRequirements: {},   // New: { targetRoleId: [requiredRoleId1, requiredRoleId2] }
      channelId: null,
      messageId: null,
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
  saveRoleDescriptions(menuId, descriptions) { // New function to save role descriptions
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    Object.assign(menu.dropdownRoleDescriptions, descriptions); // For now, only for dropdowns
  },
  saveRoleRequirements(menuId, roleRequirements) { // New function to save role requirements
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.roleRequirements = roleRequirements;
  },
  saveEmbedCustomization(menuId, embedSettings) { 
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    Object.assign(menu, embedSettings); 
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
  clearMessageId(menuId) { // New function to clear message ID
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.channelId = null;
    menu.messageId = null;
  }
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

// Helper function to check role requirements
function checkRoleRequirements(member, menu, targetRoleId) {
    const requiredRoleIds = menu.roleRequirements[targetRoleId];
    if (!requiredRoleIds || requiredRoleIds.length === 0) {
        return true; // No requirements set for this role
    }

    const missingRoles = requiredRoleIds.filter(reqId => !member.roles.cache.has(reqId));
    if (missingRoles.length > 0) {
        const missingRoleNames = missingRoles.map(id => member.guild.roles.cache.get(id)?.name || `Unknown Role (${id})`).join(', ');
        return `You need the role(s): ${missingRoleNames} to get <@&${targetRoleId}>.`;
    }
    return true; // All requirements met
}


const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST().setToken(process.env.TOKEN);
  const cmd = new SlashCommandBuilder().setName("dashboard").setDescription("Open the guild dashboard").toJSON();
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
  console.log("📑 /dashboard command deployed");
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

        if (action === "edit_published") { // New button action for editing published message
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
                return publishMenu(interaction, targetMenuId, message); // Pass the fetched message to edit
            } catch (error) {
                console.error("Error fetching message to edit:", error);
                return interaction.reply({ content: "❌ Failed to fetch published message. It might have been deleted manually.", ephemeral: true });
            }
        }

        if (action === "delete_published") { // New button action for deleting published message
            const targetMenuId = extra;
            if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
            const menu = db.getMenu(targetMenuId);
            if (!menu || !menu.channelId || !menu.messageId) {
                return interaction.reply({ content: "❌ No published message found for this menu to delete.", ephemeral: true });
            }

            // Confirmation step for deletion
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

        if (action === "confirm_delete_published") { // Confirmation handler
            const targetMenuId = extra;
            const menu = db.getMenu(targetMenuId);
            if (!menu || !menu.channelId || !menu.messageId) {
                return interaction.update({ content: "❌ No published message found or already deleted.", components: [], ephemeral: true });
            }
            const channel = interaction.guild.channels.cache.get(menu.channelId);
            if (!channel) {
                db.clearMessageId(targetMenuId); // Clear if channel is gone
                return interaction.update({ content: "❌ Published channel not found. Message ID cleared.", components: [], ephemeral: true });
            }

            try {
                const message = await channel.messages.fetch(menu.messageId);
                await message.delete();
                db.clearMessageId(targetMenuId); // Clear message ID from DB
                await interaction.update({ content: "✅ Published reaction role message deleted successfully!", components: [], ephemeral: true });
                return showMenuConfiguration(interaction, targetMenuId); // Refresh config view
            } catch (error) {
                console.error("Error deleting message:", error);
                db.clearMessageId(targetMenuId); // Clear message ID if it's already deleted or inaccessible
                return interaction.update({ content: "❌ Failed to delete published message. It might have been deleted manually or bot lacks permissions. Message ID cleared.", components: [], ephemeral: true });
            }
        }

        if (action === "cancel_delete_published") { // Cancellation handler
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
            .setTitle("Set Regional Role Limits & Max Roles") // Updated title
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
              new ActionRowBuilder().addComponents( // New input for max roles limit
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

        if (action === "customize_messages") { 
            const targetMenuId = extra;
            if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
            const menu = db.getMenu(targetMenuId);
            if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

            const modal = new ModalBuilder()
                .setCustomId(`rr:modal:customize_messages:${targetMenuId}`)
                .setTitle("Customize User Messages")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("success_add")
                            .setLabel("Success Message (Role Added)")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setPlaceholder("✅ You now have the role {roleName}!")
                            .setValue(menu.successMessageAdd || "")
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("success_remove")
                            .setLabel("Success Message (Role Removed)")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setPlaceholder("✅ You removed the role {roleName}!")
                            .setValue(menu.successMessageRemove || "")
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("limit_exceeded")
                            .setLabel("Limit Exceeded Message")
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                            .setPlaceholder("❌ You have reached the maximum number of roles for this menu or region.")
                            .setValue(menu.limitExceededMessage || "")
                    )
                );
            return interaction.showModal(modal);
        }

        if (action === "set_role_order") { 
            const targetMenuId = extra;
            if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
            const menu = db.getMenu(targetMenuId);
            if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

            // Get roles assigned to this menu for pre-filling
            const dropdownRolesInMenu = menu.dropdownRoles.map(id => interaction.guild.roles.cache.get(id)).filter(Boolean);
            const buttonRolesInMenu = menu.buttonRoles.map(id => interaction.guild.roles.cache.get(id)).filter(Boolean);

            // Format existing order or default to all roles assigned to the menu
            const currentDropdownOrder = menu.dropdownRoleOrder.length > 0
                ? menu.dropdownRoleOrder.map(id => {
                    const role = interaction.guild.roles.cache.get(id);
                    return role ? `${role.name} (${role.id})` : null;
                }).filter(Boolean).join(', ')
                : dropdownRolesInMenu.map(role => `${role.name} (${role.id})`).join(', ');

            const currentButtonOrder = menu.buttonRoleOrder.length > 0
                ? menu.buttonRoleOrder.map(id => {
                    const role = interaction.guild.roles.cache.get(id);
                    return role ? `${role.name} (${role.id})` : null;
                }).filter(Boolean).join(', '); // Removed the extra colon here
                : buttonRolesInMenu.map(role => `${role.name} (${role.id})`).join(', ');

            const modal = new ModalBuilder()
                .setCustomId(`rr:modal:set_role_order:${targetMenuId}`)
                .setTitle("Set Role Display Order")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("dropdown_order")
                            .setLabel("Dropdown Roles Order (Comma-separated: Name (ID))")
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                            .setPlaceholder("Role Name 1 (ID1), Role Name 2 (ID2)")
                            .setValue(currentDropdownOrder)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("button_order")
                            .setLabel("Button Roles Order (Comma-separated: Name (ID))")
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                            .setPlaceholder("Role Name A (IDA), Role Name B (IDB)")
                            .setValue(currentButtonOrder)
                    )
                );
            return interaction.showModal(modal);
        }

        if (action === "set_role_descriptions") { // New button action for role descriptions
            const targetMenuId = extra;
            if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
            const menu = db.getMenu(targetMenuId);
            if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

            const modal = new ModalBuilder()
                .setCustomId(`rr:modal:set_role_descriptions:${targetMenuId}`)
                .setTitle("Set Dropdown Role Descriptions");
            
            if (!menu.dropdownRoles.length) {
                return interaction.reply({ content: "No dropdown roles configured to add descriptions for.", ephemeral: true });
            }

            // Add text inputs for each dropdown role
            // Discord modals limit to 5 action rows (5 text inputs)
            const rolesForDescription = menu.dropdownRoles.slice(0, 5); // Limit to first 5 for simplicity
            rolesForDescription.forEach(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId(roleId)
                                .setLabel(`Description for ${role.name}`)
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(false)
                                .setPlaceholder(`Short description for ${role.name} (max 100 chars)`)
                                .setValue(menu.dropdownRoleDescriptions[roleId] || "")
                                .setMaxLength(100) // Discord dropdown description limit
                        )
                    );
                }
            });

            if (menu.dropdownRoles.length > 5) {
                // Inform user about limitation or suggest pagination if this were a full app
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("info_message")
                            .setLabel("Note: Only first 5 roles shown due to Discord limits.")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setDisabled(true)
                            .setValue("")
                    )
                );
            }

            return interaction.showModal(modal);
        }

        if (action === "set_role_requirements") { // New button action for role requirements
            const targetMenuId = extra;
            if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
            const menu = db.getMenu(targetMenuId);
            if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

            const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
            if (!allRoles.size) return interaction.reply({ content: "No roles available to set requirements.", ephemeral: true });

            const selectTargetRole = new StringSelectMenuBuilder()
                .setCustomId(`rr:select_requirement_target_role:${targetMenuId}`)
                .setPlaceholder("Select a role that will have requirements...")
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));
            
            return interaction.update({
                content: "Please select the role for which you want to set requirements:",
                components: [new ActionRowBuilder().addComponents(selectTargetRole)],
                ephemeral: true
            });
        }

        if (action === "config") {
          const targetMenuId = extra; 
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
          return showMenuConfiguration(interaction, targetMenuId); 
        }
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");

      // All modal submits related to dashboard config should also have a permission check
      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] !== "create") { 
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
              return interaction.reply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
          }
      }


      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "create") {
        const name = interaction.fields.getTextInputValue("name");
        const desc = interaction.fields.getTextInputValue("desc");
        if (!name || !desc) return interaction.reply({ content: "Name and description are required.", ephemeral: true });
        const menuId = db.createMenu(interaction.guild.id, name, desc);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:type:dropdown:${menuId}`).setLabel("Use Dropdown").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:button:${menuId}`).setLabel("Use Buttons").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:both:${menuId}`).setLabel("Use Both").setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ content: "Choose how users should select roles:", components: [row], ephemeral: true });
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "addemoji") {
        const type = parts[3]; 
        const menuId = parts[4];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const emojis = {};
        for (const [key, input] of interaction.fields.fields) {
          const val = input.value;
          if (val && val.trim()) {
            emojis[key] = val.trim();
          }
        }
        db.saveEmojis(menuId, emojis, type);
        return interaction.reply({ content: `✅ Emojis saved for ${type}. You can now publish the menu!`, ephemeral: true });
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "setlimits") {
        const menuId = parts[3];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        try {
          const auLimit = interaction.fields.getTextInputValue("au_limit"); 
          const euLimit = interaction.fields.getTextInputValue("eu_limit"); 
          const naLimit = interaction.fields.getTextInputValue("na_limit"); 
          const regionalRoleAssignmentsRaw = interaction.fields.getTextInputValue("regional_role_assignments"); 
          const maxRolesLimitInput = interaction.fields.getTextInputValue("max_roles_limit"); 

          let regionalRoleAssignments = {};
          if (regionalRoleAssignmentsRaw && regionalRoleAssignmentsRaw.trim()) {
            regionalRoleAssignments = JSON.parse(regionalRoleAssignmentsRaw);
          }
          
          const regionalLimits = {};
          
          if (auLimit && !isNaN(auLimit)) {
            regionalLimits.AU = {
              limit: Number(auLimit),
              roleIds: regionalRoleAssignments.AU || []
            };
          }
          
          if (euLimit && !isNaN(euLimit)) {
            regionalLimits.EU = {
              limit: Number(euLimit),
              roleIds: regionalRoleAssignments.EU || []
            };
          }
          
          if (naLimit && !isNaN(naLimit)) {
            regionalLimits.NA = {
              limit: Number(naLimit),
              roleIds: regionalRoleAssignments.NA || []
            };
          }

          let maxRolesLimit = null;
          if (maxRolesLimitInput && !isNaN(maxRolesLimitInput) && Number(maxRolesLimitInput) >= 0) {
              maxRolesLimit = Number(maxRolesLimitInput);
          }

          db.saveRegionalLimits(menuId, regionalLimits);
          db.saveMaxRolesLimit(menuId, maxRolesLimit); 
          await interaction.reply({ content: "✅ Regional limits and max roles limit saved.", ephemeral: true });
          return showMenuConfiguration(interaction, menuId); 
        } catch (error) {
          console.error("Error saving regional limits or max roles limit:", error);
          return interaction.reply({ content: "❌ Invalid JSON format in regional role assignments or invalid limit value.", ephemeral: true });
        }
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "customize_embed") { 
        const menuId = parts[3];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const embedSettings = {
          embedColor: interaction.fields.getTextInputValue("embed_color") || null,
          embedThumbnail: interaction.fields.getTextInputValue("thumbnail_url") || null,
          embedImage: interaction.fields.getTextInputValue("image_url") || null,
          embedAuthorName: interaction.fields.getTextInputValue("author_name") || null,
          embedAuthorIconURL: interaction.fields.getTextInputValue("author_icon_url") || null,
        };

        db.saveEmbedCustomization(menuId, embedSettings);
        await interaction.reply({ content: "✅ Embed customization saved!", ephemeral: true });
        return showMenuConfiguration(interaction, menuId); 
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "customize_footer") { 
        const menuId = parts[3];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const footerText = interaction.fields.getTextInputValue("footer_text") || null;
        const footerIconURL = interaction.fields.getTextInputValue("footer_icon_url") || null;

        db.saveEmbedCustomization(menuId, {
            embedFooterText: footerText,
            embedFooterIconURL: footerIconURL,
        });
        await interaction.reply({ content: "✅ Embed footer saved!", ephemeral: true });
        return showMenuConfiguration(interaction, menuId); 
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "customize_messages") { 
          const menuId = parts[3];
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const messages = {
              successMessageAdd: interaction.fields.getTextInputValue("success_add") || null,
              successMessageRemove: interaction.fields.getTextInputValue("success_remove") || null,
              limitExceededMessage: interaction.fields.getTextInputValue("limit_exceeded") || null,
          };

          db.saveCustomMessages(menuId, messages);
          await interaction.reply({ content: "✅ Custom messages saved!", ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "set_role_order") { 
          const menuId = parts[3];
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const dropdownOrderRaw = interaction.fields.getTextInputValue("dropdown_order");
          const buttonOrderRaw = interaction.fields.getTextInputValue("button_order");

          const idRegex = /\((\d+)\)/g;

          const extractIds = (rawString, allowedRoles) => {
              const extracted = [];
              let match;
              while ((match = idRegex.exec(rawString)) !== null) {
                  const id = match[1];
                  if (allowedRoles.includes(id)) {
                      extracted.push(id);
                  }
              }
              return extracted;
          };

          const dropdownOrder = extractIds(dropdownOrderRaw, menu.dropdownRoles);
          const buttonOrder = extractIds(buttonOrderRaw, menu.buttonRoles);

          db.saveRoleOrder(menuId, dropdownOrder, "dropdown");
          db.saveRoleOrder(menuId, buttonOrder, "button");
          
          await interaction.reply({ content: "✅ Role display order saved!", ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "set_role_descriptions") { // New modal submit handler for role descriptions
          const menuId = parts[3];
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          const descriptions = {};
          for (const [roleId, input] of interaction.fields.fields) {
              if (roleId === "info_message") continue; // Skip the info message field
              const desc = input.value.trim();
              if (desc) {
                  descriptions[roleId] = desc;
              } else {
                  delete descriptions[roleId]; // Remove if empty
              }
          }
          db.saveRoleDescriptions(menuId, descriptions);
          await interaction.reply({ content: "✅ Dropdown role descriptions saved!", ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "set_role_requirements") { // New modal submit handler for role requirements
        const [_, __, menuId, targetRoleId] = interaction.customId.split(":");
        const requiredRoleIds = interaction.values; // This will be from a select menu, not modal text inputs
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const currentRoleRequirements = menu.roleRequirements;
        currentRoleRequirements[targetRoleId] = requiredRoleIds;
        db.saveRoleRequirements(menuId, currentRoleRequirements);

        const targetRoleName = interaction.guild.roles.cache.get(targetRoleId)?.name || "Unknown Role";
        const requiredRoleNames = requiredRoleIds.map(id => interaction.guild.roles.cache.get(id)?.name || `Unknown Role (${id})`).join(', ');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rr:set_role_requirements:${menuId}`).setLabel("➕ Add Another Requirement").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`rr:config:${menuId}`).setLabel("🔙 Back to Menu Config").setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            content: `✅ Requirement saved: Picking **${targetRoleName}** now requires: ${requiredRoleNames || "no roles"}. What would you like to do next?`,
            components: [row],
            ephemeral: true
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("rr:selectroles:")) {
        const [_, __, type, menuId] = interaction.customId.split(":");
        if (!interaction.values.length) return interaction.reply({ content: "❌ No roles selected.", ephemeral: true });

        db.saveRoles(menuId, interaction.values, type);

        const selectionType = db.getMenu(menuId)?.selectionType || [];
        const stillNeeds =
          selectionType.includes("dropdown") && !db.getMenu(menuId).dropdownRoles.length
            ? "dropdown"
            : selectionType.includes("button") && !db.getMenu(menuId).buttonRoles.length
            ? "button"
            : null;

        if (stillNeeds) {
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${stillNeeds}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.update({
            content: `✅ Saved roles for ${type}. Now select roles for **${stillNeeds}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }

        return showMenuConfiguration(interaction, menuId);
      }

      if (interaction.customId.startsWith("rr:select_trigger_role:")) { 
        const menuId = interaction.customId.split(":")[2];
        const triggerRoleId = interaction.values[0];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
        const options = allRoles
            .filter(r => r.id !== triggerRoleId) 
            .map(r => ({ label: r.name, value: r.id })));

        if (!options.length) {
            return interaction.update({ content: "No other roles available to exclude.", components: [], ephemeral: true });
        }

        const selectExcludedRoles = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_excluded_roles:${menuId}:${triggerRoleId}`)
            .setPlaceholder(`Select roles to be removed when ${interaction.guild.roles.cache.get(triggerRoleId)?.name} is picked...`)
            .setMinValues(0) 
            .setMaxValues(options.length)
            .addOptions(options);

        return interaction.update({
            content: `Now select roles that should be removed when <@&${triggerRoleId}> is picked:`,
            components: [new ActionRowBuilder().addComponents(selectExcludedRoles)],
            ephemeral: true
        });
      }

      if (interaction.customId.startsWith("rr:select_excluded_roles:")) { 
        const [_, __, menuId, triggerRoleId] = interaction.customId.split(":");
        const excludedRoleIds = interaction.values;
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const currentExclusionMap = menu.exclusionMap;
        currentExclusionMap[triggerRoleId] = excludedRoleIds;
        db.saveExclusionMap(menuId, currentExclusionMap);

        return showMenuConfiguration(interaction, menuId);
      }

      if (interaction.customId.startsWith("rr:select_requirement_target_role:")) { // New handler for selecting target role for requirements
        const menuId = interaction.customId.split(":")[2];
        const targetRoleId = interaction.values[0];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
        const options = allRoles
            .filter(r => r.id !== targetRoleId) // A role cannot require itself
            .map(r => ({ label: r.name, value: r.id }));

        if (!options.length) {
            return interaction.update({ content: "No other roles available to set as requirements.", components: [], ephemeral: true });
        }

        // Pre-select currently required roles if any
        const currentRequiredRoles = menu.roleRequirements[targetRoleId] || [];

        const selectRequiredRoles = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_required_roles:${menuId}:${targetRoleId}`)
            .setPlaceholder(`Select roles required to get ${interaction.guild.roles.cache.get(targetRoleId)?.name}...`)
            .setMinValues(0) // Allow setting no requirements (clearing)
            .setMaxValues(options.length)
            .addOptions(options)
            .setDefaultValues(currentRequiredRoles); // Pre-select existing requirements

        return interaction.update({
            content: `Now select roles that are required to get <@&${targetRoleId}>:`,
            components: [new ActionRowBuilder().addComponents(selectRequiredRoles)],
            ephemeral: true
        });
      }

      if (interaction.customId.startsWith("rr:select_required_roles:")) { // New handler for selecting required roles
        const [_, __, menuId, targetRoleId] = interaction.customId.split(":");
        const requiredRoleIds = interaction.values;
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const currentRoleRequirements = menu.roleRequirements;
        currentRoleRequirements[targetRoleId] = requiredRoleIds;
        db.saveRoleRequirements(menuId, currentRoleRequirements);

        return showMenuConfiguration(interaction, menuId);
      }

      if (interaction.customId.startsWith("rr:use:")) {
        const menuId = interaction.customId.split(":")[2];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const chosen = interaction.values;
        const member = interaction.member;
        const memberRolesCache = member.roles.cache;
        const currentMenuRoles = new Set(menu.dropdownRoles.concat(menu.buttonRoles).filter(roleId => memberRolesCache.has(roleId)));

        // Check max roles limit for the menu
        if (menu.maxRolesLimit !== null && chosen.length > menu.maxRolesLimit) {
            return interaction.reply({ content: menu.limitExceededMessage.replace('{limit}', menu.maxRolesLimit), ephemeral: true });
        }

        const violations = checkRegionalLimits(member, menu, chosen);
        if (violations.length > 0) {
          return interaction.reply({ content: `❌ ${violations.join(' ')}`, ephemeral: true });
        }

        // Check role requirements for each role being added
        for (const selectedRoleId of chosen) {
            if (!memberRolesCache.has(selectedRoleId)) { // Only check requirements if role is being added
                const requirementCheck = checkRoleRequirements(member, menu, selectedRoleId);
                if (requirementCheck !== true) {
                    return interaction.reply({ content: `❌ ${requirementCheck}`, ephemeral: true });
                }
            }
        }

        const rolesToRemoveDueToExclusion = new Set();
        for (const selectedRoleId of chosen) {
          if (menu.exclusionMap[selectedRoleId]) {
            for (const excludedRoleId of menu.exclusionMap[selectedRoleId]) {
              if (memberRolesCache.has(excludedRoleId)) {
                rolesToRemoveDueToExclusion.add(excludedRoleId);
              }
            }
          }
        }

        for (const roleId of menu.dropdownRoles) {
          if (chosen.includes(roleId)) {
            if (!memberRolesCache.has(roleId)) await member.roles.add(roleId);
          } else {
            if (memberRolesCache.has(roleId)) await member.roles.remove(roleId);
          }
        }
        
        for (const roleId of rolesToRemoveDueToExclusion) {
            if (memberRolesCache.has(roleId)) {
                await member.roles.remove(roleId);
            }
        }

        return interaction.reply({ content: menu.successMessageAdd.replace('{roleName}', 'your selected roles'), ephemeral: true }); // Simplified for multiple roles
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
      const roleId = interaction.customId.split(":")[2];
      const member = interaction.member;
      const hasRole = member.roles.cache.has(roleId);

      let targetMenu = null;
      for (const [menuId, menu] of db.menuData) {
        if (menu.buttonRoles.includes(roleId)) {
          targetMenu = menu;
          break;
        }
      }

      if (!targetMenu) {
        return interaction.reply({ content: "Menu not found for this role.", ephemeral: true });
      }

      const memberRolesCache = member.roles.cache;
      const currentMenuRoles = new Set(targetMenu.dropdownRoles.concat(targetMenu.buttonRoles).filter(id => memberRolesCache.has(id)));

      if (!hasRole) { // If adding a role
        // Check max roles limit for the menu
        if (targetMenu.maxRolesLimit !== null && currentMenuRoles.size >= targetMenu.maxRolesLimit) {
            return interaction.reply({ content: targetMenu.limitExceededMessage.replace('{limit}', targetMenu.maxRolesLimit), ephemeral: true });
        }

        const currentRolesArray = Array.from(memberRolesCache.keys());
        const newRolesArray = [...currentRolesArray, roleId];
        const violations = checkRegionalLimits(member, targetMenu, newRolesArray);
        
        if (violations.length > 0) {
          return interaction.reply({ content: `❌ ${violations.join(' ')}`, ephemeral: true });
        }

        // Check role requirements
        const requirementCheck = checkRoleRequirements(member, targetMenu, roleId);
        if (requirementCheck !== true) {
            return interaction.reply({ content: `❌ ${requirementCheck}`, ephemeral: true });
        }
      }

      if (!hasRole && targetMenu.exclusionMap[roleId]) {
        for (const excludedRoleId of targetMenu.exclusionMap[roleId]) {
          if (member.roles.cache.has(excludedRoleId)) {
            await member.roles.remove(excludedRoleId);
          }
        }
      }

      if (hasRole) {
        await member.roles.remove(roleId);
        return interaction.reply({ content: targetMenu.successMessageRemove.replace('{roleId}', roleId).replace('{roleName}', interaction.guild.roles.cache.get(roleId)?.name || 'Unknown Role'), ephemeral: true });
      } else {
        await member.roles.add(roleId);
        return interaction.reply({ content: targetMenu.successMessageAdd.replace('{roleId}', roleId).replace('{roleName}', interaction.guild.roles.cache.get(roleId)?.name || 'Unknown Role'), ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("rr:clear_roles:")) { 
        const menuId = interaction.customId.split(":")[2];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const member = interaction.member;
        const rolesToRemove = new Set();

        const allMenuRoles = new Set([...menu.dropdownRoles, ...menu.buttonRoles]);

        for (const roleId of allMenuRoles) {
            if (member.roles.cache.has(roleId)) {
                rolesToRemove.add(roleId);
            }
        }

        if (rolesToRemove.size === 0) {
            return interaction.reply({ content: "You don't have any roles from this menu to clear.", ephemeral: true });
        }

        for (const roleId of rolesToRemove) {
            await member.roles.remove(roleId);
        }

        return interaction.reply({ content: "✅ All your roles from this menu have been cleared!", ephemeral: true });
    }

  } catch (error) {
    console.error("Error handling interaction:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
    }
  }
});

async function sendMainDashboard(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("🛠️ Server Dashboard")
    .setDescription("Click a button to configure server features:")
    .setColor(0x5865F2);
    
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("dash:reaction-roles").setLabel("🎨 Reaction Roles").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary).setDisabled(true)
  );
  
  const method = interaction.replied ? 'editReply' : 'reply';
  await interaction[method]({ embeds: [embed], components: [row], ephemeral: true });
}

async function showReactionRolesDashboard(interaction) {
  const menus = db.getMenus(interaction.guild.id);
  const embed = new EmbedBuilder()
    .setTitle("🎨 Reaction Roles Manager")
    .setDescription(menus.length ? menus.map((m, i) => `**${i + 1}.** ${m.name} (${m.selectionType.join(", ") || "Not configured"})`).join("\n") : "*No reaction role menus created yet*")
    .setColor(0x5865F2);
    
  const buttons = [
    new ButtonBuilder().setCustomId("rr:create").setLabel("➕ Create New Menu").setStyle(ButtonStyle.Success)
  ];
  
  menus.slice(0, 3).forEach((m, i) => {
    buttons.push(new ButtonBuilder().setCustomId(`rr:config:${m.id}`).setLabel(`⚙️ Menu ${i + 1}`).setStyle(ButtonStyle.Primary));
  });
  
  buttons.push(new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary));
  
  const row = new ActionRowBuilder().addComponents(buttons);
  await interaction.update({ embeds: [embed], components: [row] });
}

async function showMenuConfiguration(interaction, menuId) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Configure: ${menu.name}`)
    .setDescription(`**Description:** ${menu.desc}`)
    .addFields(
      { name: "Selection Type", value: menu.selectionType.join(", ") || "None", inline: true },
      { name: "Dropdown Roles", value: menu.dropdownRoles.length.toString(), inline: true },
      { name: "Button Roles", value: menu.buttonRoles.length.toString(), inline: true },
      { 
        name: "Regional Limits", 
        value: Object.keys(menu.regionalLimits).length 
          ? Object.entries(menu.regionalLimits).map(([region, data]) => `${region}: ${data.limit || 0}`).join(", ")
          : "None set", 
        inline: false 
      },
      { 
        name: "Max Roles Per Menu",
        value: menu.maxRolesLimit !== null ? menu.maxRolesLimit.toString() : "No limit",
        inline: true
      },
      { 
        name: "Exclusion Map",
        value: Object.keys(menu.exclusionMap).length
          ? Object.entries(menu.exclusionMap).map(([triggerId, excludedIds]) => {
              const triggerRole = interaction.guild.roles.cache.get(triggerId);
              const excludedRoleNames = excludedIds.map(id => interaction.guild.roles.cache.get(id)?.name || `Unknown Role (${id})`).join(', ');
              return `**${triggerRole?.name || `Unknown Role (${triggerId})`}** excludes: ${excludedRoleNames}`;
            }).join('\n')
          : "None set",
        inline: false
      },
      { 
        name: "Role Requirements", // New field for role requirements display
        value: Object.keys(menu.roleRequirements).length
          ? Object.entries(menu.roleRequirements).map(([targetId, requiredIds]) => {
              const targetRole = interaction.guild.roles.cache.get(targetId);
              const requiredRoleNames = requiredIds.map(id => interaction.guild.roles.cache.get(id)?.name || `Unknown Role (${id})`).join(', ');
              return `**${targetRole?.name || `Unknown Role (${targetId})`}** requires: ${requiredRoleNames}`;
            }).join('\n')
          : "None set",
        inline: false
      },
      { 
        name: "Embed Color",
        value: menu.embedColor || "Default (Blue)",
        inline: true
      },
      { 
        name: "Thumbnail",
        value: menu.embedThumbnail ? "Set" : "None",
        inline: true
      },
      { 
        name: "Image",
        value: menu.embedImage ? "Set" : "None",
        inline: true
      },
      { 
        name: "Author",
        value: menu.embedAuthorName ? `${menu.embedAuthorName} ${menu.embedAuthorIconURL ? "(with icon)" : ""}` : "None",
        inline: true
      },
      { 
        name: "Footer",
        value: menu.embedFooterText ? `${menu.embedFooterText} ${menu.embedFooterIconURL ? "(with icon)" : ""}` : "Default",
        inline: true
      },
      { 
        name: "Custom Messages",
        value: (menu.successMessageAdd || menu.successMessageRemove || menu.limitExceededMessage) ? "Configured" : "Default",
        inline: true
      },
      { 
        name: "Role Order",
        value: (menu.dropdownRoleOrder.length || menu.buttonRoleOrder.length) ? "Custom" : "Default",
        inline: true
      },
      { // New field for Role Descriptions display
        name: "Dropdown Role Descriptions",
        value: Object.keys(menu.dropdownRoleDescriptions).length ? "Configured" : "None",
        inline: true
      }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rr:addemoji:dropdown:${menuId}`).setLabel("🎨 Dropdown Emojis").setStyle(ButtonStyle.Secondary).setDisabled(!menu.dropdownRoles.length),
    new ButtonBuilder().setCustomId(`rr:addemoji:button:${menuId}`).setLabel("🎨 Button Emojis").setStyle(ButtonStyle.Secondary).setDisabled(!menu.buttonRoles.length),
    new ButtonBuilder().setCustomId(`rr:setlimits:${menuId}`).setLabel("📊 Limits & Max Roles").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rr:setexclusions:${menuId}`).setLabel("🚫 Set Exclusions").setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rr:customize_embed:${menuId}`).setLabel("🖼️ Customize Embed").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rr:customize_footer:${menuId}`).setLabel("📝 Customize Footer").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rr:customize_messages:${menuId}`).setLabel("💬 Custom Messages").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rr:set_role_order:${menuId}`).setLabel("⬆️ Set Role Order").setStyle(ButtonStyle.Primary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rr:set_role_descriptions:${menuId}`).setLabel("📝 Set Dropdown Descriptions").setStyle(ButtonStyle.Primary).setDisabled(!menu.dropdownRoles.length), // New button
    new ButtonBuilder().setCustomId(`rr:set_role_requirements:${menuId}`).setLabel("🔒 Set Role Requirements").setStyle(ButtonStyle.Primary), // New button
    new ButtonBuilder().setCustomId(`rr:edit_published:${menuId}`).setLabel("✏️ Edit Published").setStyle(ButtonStyle.Secondary).setDisabled(!menu.messageId), // New button
    new ButtonBuilder().setCustomId(`rr:delete_published:${menuId}`).setLabel("🗑️ Delete Published").setStyle(ButtonStyle.Danger).setDisabled(!menu.messageId) // New button
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("dash:reaction-roles").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
  );

  const method = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
  await interaction[method]({ embeds: [embed], components: [row, row2, row3, row4], ephemeral: true });
}


async function publishMenu(interaction, menuId, messageToEdit = null) { // Added messageToEdit parameter
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle(menu.name)
    .setDescription(menu.desc);

  if (menu.embedColor) {
    try {
      embed.setColor(menu.embedColor);
    } catch (e) {
      console.error("Invalid embed color:", menu.embedColor, e);
      embed.setColor(0x5865F2); 
    }
  } else {
    embed.setColor(0x5865F2); 
  }

  if (menu.embedThumbnail) {
    embed.setThumbnail(menu.embedThumbnail);
  }

  if (menu.embedImage) {
    embed.setImage(menu.embedImage);
  }

  if (menu.embedAuthorName) {
    embed.setAuthor({ 
      name: menu.embedAuthorName, 
      iconURL: menu.embedAuthorIconURL || null 
    });
  }

  embed.setFooter({ 
      text: menu.embedFooterText || "Select your roles below!", 
      iconURL: menu.embedFooterIconURL || null 
  });

  const components = [];

  // Add dropdown if configured
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const orderedDropdownRoles = menu.dropdownRoleOrder.length > 0
      ? menu.dropdownRoleOrder.filter(roleId => menu.dropdownRoles.includes(roleId))
      : menu.dropdownRoles;

    const options = orderedDropdownRoles
      .map((roleId) => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        const emojiStr = menu.dropdownEmojis[roleId];
        const option = {
          label: role.name,
          value: role.id,
          description: menu.dropdownRoleDescriptions[roleId] || `Click to toggle ${role.name}`, // Use custom description
        };
        if (emojiStr) {
          const parsedEmoji = parseEmoji(emojiStr);
          if (parsedEmoji) option.emoji = parsedEmoji;
        }
        return option;
      })
      .filter(Boolean);

    if (options.length) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`rr:use:${menuId}`)
        .setPlaceholder("Select roles from the dropdown...")
        .setMinValues(0)
        .setMaxValues(options.length)
        .addOptions(options);
      components.push(new ActionRowBuilder().addComponents(select));
    }
  }

  // Add buttons if configured
  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const orderedButtonRoles = menu.buttonRoleOrder.length > 0
      ? menu.buttonRoleOrder.filter(roleId => menu.buttonRoles.includes(roleId))
      : menu.buttonRoles;

    const buttons = orderedButtonRoles
      .map((roleId) => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        const emojiStr = menu.buttonEmojis[roleId];
        const button = new ButtonBuilder()
          .setCustomId(`rr:assign:${roleId}`)
          .setLabel(role.name)
          .setStyle(ButtonStyle.Secondary);
        if (emojiStr) {
          try {
            const parsedEmoji = parseEmoji(emojiStr);
            if (parsedEmoji) button.setEmoji(parsedEmoji);
          } catch (err) {
            console.log(`Failed to set emoji for role ${role.name}:`, err.message);
          }
        }
        return button;
      })
      .filter(Boolean);

    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  if (menu.dropdownRoles.length > 0 || menu.buttonRoles.length > 0) {
      const clearButtonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
              .setCustomId(`rr:clear_roles:${menuId}`)
              .setLabel("Clear My Roles")
              .setStyle(ButtonStyle.Danger)
      );
      components.push(clearButtonRow);
  }


  if (components.length === 0) {
    return interaction.reply({ content: "❌ No roles configured for this menu.", ephemeral: true });
  }

  try {
    let message;
    if (messageToEdit) {
        message = await messageToEdit.edit({ embeds: [embed], components });
        await interaction.reply({ content: "✅ Published reaction role menu updated successfully!", ephemeral: true });
    } else {
        message = await interaction.channel.send({ embeds: [embed], components });
        await interaction.reply({ content: "🚀 Reaction role menu published successfully!", ephemeral: true });
    }
    db.saveMessageId(menuId, interaction.channel.id, message.id);
  } catch (error) {
    console.error("Error publishing/editing menu:", error);
    return interaction.reply({ content: "❌ Failed to publish/edit menu. Check that emojis are valid or image URLs are accessible, and bot has permissions to send/edit messages.", ephemeral: true });
  }
}

client.login(process.env.TOKEN);
