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
      channelId: null,
      messageId: null,
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
  saveExclusionMap(menuId, exclusionMap) { // New function to save exclusion map
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.exclusionMap = exclusionMap;
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
};

// Helper function to parse emoji strings for Discord components
function parseEmoji(emoji) {
  if (!emoji) return null;
  
  // Check if it's a custom emoji: <a:name:id> or <:name:id>
  const customEmojiRegex = /^<a?:([a-zA-Z0-9_]+):(\d+)>$/;
  const match = emoji.match(customEmojiRegex);
  
  if (match) {
    return {
      id: match[2],
      name: match[1],
      animated: emoji.startsWith("<a:"),
    };
  }
  
  // It's a unicode emoji
  return { name: emoji };
}

// Helper function to check regional limits
function checkRegionalLimits(member, menu, newRoleIds) {
  const memberRoles = member.roles.cache;
  const violations = [];

  for (const [regionName, regionData] of Object.entries(menu.regionalLimits)) {
    const { limit, roleIds } = regionData;
    if (!limit || !roleIds || !roleIds.length) continue;

    // Count how many roles from this region the user would have after the change
    const currentRegionRoles = roleIds.filter(roleId => memberRoles.has(roleId));
    const newRegionRoles = roleIds.filter(roleId => newRoleIds.includes(roleId));
    
    // For dropdown: newRoleIds represents the complete new selection
    // For buttons: we need to check if adding this role would exceed the limit
    // We only check for violations if the new role is being added, not removed.
    // If the newRoleIds array contains more roles from a region than allowed, it's a violation.
    // This logic assumes newRoleIds is the *final desired state* for dropdowns,
    // and for buttons, it's the state *after* potentially adding one role.
    if (newRegionRoles.length > limit) {
      violations.push(`You can only select ${limit} role(s) from the ${regionName} region.`);
    }
  }

  return violations;
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
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
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
        if (action === "create") {
          // New reaction role menu modal
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

        if (action === "type") {
          const targetMenuId = menuId; 
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing for selection type.", ephemeral: true });
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(targetMenuId, selectedTypes);

          // Start with dropdown roles selection if included
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
            .setTitle("Set Regional Role Limits")
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

        if (action === "config") {
          const targetMenuId = extra; 
          if (!targetMenuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
          return showMenuConfiguration(interaction, targetMenuId); // Call the dedicated function
        }
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");

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

          db.saveRegionalLimits(menuId, regionalLimits);
          return interaction.reply({ content: "✅ Regional limits saved.", ephemeral: true });
        } catch (error) {
          console.error("Error saving regional limits:", error);
          return interaction.reply({ content: "❌ Invalid JSON format in regional role assignments.", ephemeral: true });
        }
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

        // After all roles are selected, directly show the menu configuration
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
            .map(r => ({ label: r.name, value: r.id }));

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

        // After saving, immediately show the updated menu configuration
        return showMenuConfiguration(interaction, menuId);
      }

      if (interaction.customId.startsWith("rr:use:")) {
        const menuId = interaction.customId.split(":")[2];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const chosen = interaction.values;
        const member = interaction.member;

        const violations = checkRegionalLimits(member, menu, chosen);
        if (violations.length > 0) {
          return interaction.reply({ content: `❌ ${violations.join(' ')}`, ephemeral: true });
        }

        const rolesToRemoveDueToExclusion = new Set();
        for (const selectedRoleId of chosen) {
          if (menu.exclusionMap[selectedRoleId]) {
            for (const excludedRoleId of menu.exclusionMap[selectedRoleId]) {
              if (member.roles.cache.has(excludedRoleId)) {
                rolesToRemoveDueToExclusion.add(excludedRoleId);
              }
            }
          }
        }

        for (const roleId of menu.dropdownRoles) {
          if (chosen.includes(roleId)) {
            if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
          } else {
            if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
          }
        }
        
        for (const roleId of rolesToRemoveDueToExclusion) {
            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId);
            }
        }

        return interaction.reply({ content: "✅ Your roles have been updated!", ephemeral: true });
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

      if (!hasRole) { 
        const currentRoles = Array.from(member.roles.cache.keys());
        const newRoles = [...currentRoles, roleId];
        const violations = checkRegionalLimits(member, targetMenu, newRoles);
        
        if (violations.length > 0) {
          return interaction.reply({ content: `❌ ${violations.join(' ')}`, ephemeral: true });
        }
      }

      if (!hasRole && targetMenu.exclusionMap[roleId]) {
        for (const excludedRoleId of targetMenu.exclusionMap[roleId]) {
          if (member.roles.cache.has(excludedRoleId)) {
            await member.roles.remove(excludedRoleId);
          }
        }
      }

      if (hasRole) await member.roles.remove(roleId);
      else await member.roles.add(roleId);

      return interaction.reply({ content: `✅ You now ${hasRole ? "removed" : "added"} <@&${roleId}>`, ephemeral: true });
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

// Renamed from rr:config to showMenuConfiguration for clarity and reusability
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
        name: "Exclusion Map",
        value: Object.keys(menu.exclusionMap).length
          ? Object.entries(menu.exclusionMap).map(([triggerId, excludedIds]) => {
              const triggerRole = interaction.guild.roles.cache.get(triggerId);
              const excludedRoleNames = excludedIds.map(id => interaction.guild.roles.cache.get(id)?.name || `Unknown Role (${id})`).join(', ');
              return `**${triggerRole?.name || `Unknown Role (${triggerId})`}** excludes: ${excludedRoleNames}`;
            }).join('\n')
          : "None set",
        inline: false
      }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rr:addemoji:dropdown:${menuId}`).setLabel("🎨 Dropdown Emojis").setStyle(ButtonStyle.Secondary).setDisabled(!menu.dropdownRoles.length),
    new ButtonBuilder().setCustomId(`rr:addemoji:button:${menuId}`).setLabel("🎨 Button Emojis").setStyle(ButtonStyle.Secondary).setDisabled(!menu.buttonRoles.length),
    new ButtonBuilder().setCustomId(`rr:setlimits:${menuId}`).setLabel("📊 Regional Limits").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rr:setexclusions:${menuId}`).setLabel("🚫 Set Exclusions").setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("dash:reaction-roles").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
  );

  // Determine if we need to reply or update
  const method = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
  await interaction[method]({ embeds: [embed], components: [row, row2], ephemeral: true });
}


async function publishMenu(interaction, menuId) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

  // Create embed
  const embed = new EmbedBuilder()
    .setTitle(menu.name)
    .setDescription(menu.desc)
    .setColor(0x5865F2)
    .setFooter({ text: "Select your roles below!" });

  const components = [];

  // Add dropdown if configured
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const options = menu.dropdownRoles
      .map((roleId) => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        const emojiStr = menu.dropdownEmojis[roleId];
        const option = {
          label: role.name,
          value: role.id,
          description: `Click to toggle ${role.name}`,
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
    const buttons = menu.buttonRoles
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

    // Split buttons into rows (max 5 per row)
    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  if (components.length === 0) {
    return interaction.reply({ content: "❌ No roles configured for this menu.", ephemeral: true });
  }

  try {
    const message = await interaction.channel.send({ embeds: [embed], components });
    db.saveMessageId(menuId, interaction.channel.id, message.id);
    return interaction.reply({ content: "🚀 Reaction role menu published successfully!", ephemeral: true });
  } catch (error) {
    console.error("Error publishing menu:", error);
    return interaction.reply({ content: "❌ Failed to publish menu. Check that emojis are valid.", ephemeral: true });
  }
}

client.login(process.env.TOKEN);
