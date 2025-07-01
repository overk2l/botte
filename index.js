// index.js (Updated: Dropdown + Button role separation + optional emojis + role limits + exclusions)
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
      dropdownEmojis: [],  // new: emoji strings for dropdown roles (optional)
      buttonEmojis: [],    // new: emoji strings for button roles (optional)
      dropdownLimit: 0,    // 0 = no limit
      buttonLimit: 0,      // 0 = no limit
      exclusions: {},      // { groupName: [roleId, ...], ... }
      selectionType: [],
      channelId: null,
      messageId: null,
    });
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map(id => ({ id, ...this.menuData.get(id) }));
  },
  saveRoles(menuId, roles, type) {
    if (type === 'dropdown') this.menuData.get(menuId).dropdownRoles = roles;
    if (type === 'button') this.menuData.get(menuId).buttonRoles = roles;
  },
  saveEmojis(menuId, emojis, type) {
    if (type === 'dropdown') this.menuData.get(menuId).dropdownEmojis = emojis;
    if (type === 'button') this.menuData.get(menuId).buttonEmojis = emojis;
  },
  saveLimits(menuId, limit, type) {
    if (type === 'dropdown') this.menuData.get(menuId).dropdownLimit = limit;
    if (type === 'button') this.menuData.get(menuId).buttonLimit = limit;
  },
  saveExclusions(menuId, exclusions) {
    this.menuData.get(menuId).exclusions = exclusions;
  },
  saveSelectionType(menuId, types) {
    this.menuData.get(menuId).selectionType = types;
  },
  getMenu(menuId) {
    return this.menuData.get(menuId);
  },
  saveMessageId(menuId, channelId, messageId) {
    const m = this.menuData.get(menuId);
    m.channelId = channelId;
    m.messageId = messageId;
  }
};

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

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") return sendMainDashboard(interaction);

  // BUTTONS
  if (interaction.isButton()) {
    const [ctx, action, extra, menuId] = interaction.customId.split(":");

    if (ctx === "dash") {
      if (action === "reaction-roles") return showReactionRolesDashboard(interaction);
      if (action === "back") return sendMainDashboard(interaction);
    }

    if (ctx === "rr") {
      if (action === "create") {
        // Create new menu modal (name + description)
        const modal = new ModalBuilder()
          .setCustomId("rr:modal:create")
          .setTitle("New Reaction Role Menu")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("name").setLabel("Menu Name").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("desc").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(true)
            )
          );
        return interaction.showModal(modal);
      }

      if (action === "publish") return publishMenu(interaction, extra);

      if (action === "type") {
        // Save selection types (dropdown, button, both)
        let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
        db.saveSelectionType(menuId, selectedTypes);

        // Start with dropdown or button roles selection
        const nextType = selectedTypes.includes("dropdown") ? "dropdown" : "button";
        const allRoles = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);

        // Filter out duplicates if both are selected (prevent role duplicates)
        let options = allRoles;
        if (selectedTypes.length === 2) {
          // Exclude roles already selected in other type (if any)
          const otherType = nextType === "dropdown" ? "button" : "dropdown";
          const otherRoles = db.getMenu(menuId)[otherType + "Roles"];
          options = allRoles.filter(r => !otherRoles.includes(r.id));
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId(`rr:selectroles:${nextType}:${menuId}`)
          .setMinValues(1)
          .setMaxValues(Math.min(options.size, 25))
          .addOptions(options.map(r => ({ label: r.name, value: r.id })));

        return interaction.update({
          content: `✅ Selection type saved. Now select roles for **${nextType}**:`,
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }

      if (action === "addemojis") {
        // Show modal for emojis input for dropdown or button roles
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

        // Determine type param
        const type = extra;
        let roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
        if (!roles.length) return interaction.reply({ content: `❌ No roles selected for ${type} yet.`, flags: 64 });

        // Prepare a modal with one TextInput per role emoji (1 emoji per role, optional)
        // Because modals max 5 inputs, we will do one role per modal in a sequence (simpler)
        // So here we send a modal for the first role without emoji, or continue next role later
        // Store current index in extra param like: rr:addemojis:dropdown:menuId:idx
        // For simplicity, parse extra param as "dropdown" or "button" only, we use ephemeral prompts for multiple emojis (or do sequential modals)

        // Instead, for now let's just show one input modal asking for comma separated emojis in order (must match roles order)
        // User can input emojis separated by commas, or leave blank.

        const roleLabels = roles
          .map(id => {
            const r = interaction.guild.roles.cache.get(id);
            return r ? r.name : "Unknown";
          })
          .join(", ");

        const modal = new ModalBuilder()
          .setCustomId(`rr:modal:emojis:${type}:${menuId}`)
          .setTitle(`Add Emojis for ${type} roles (optional)`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("emojis")
                .setLabel(`Enter emojis separated by commas (for roles in order):\n${roleLabels}`)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
            )
          );
        return interaction.showModal(modal);
      }

      if (action === "setlimits") {
        // Show modal to set limits for dropdown or button role selection
        const type = extra;
        const modal = new ModalBuilder()
          .setCustomId(`rr:modal:limits:${type}:${menuId}`)
          .setTitle(`Set Role Limit for ${type}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("limit")
                .setLabel(`Enter max roles selectable (0 = no limit)`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            )
          );
        return interaction.showModal(modal);
      }

      if (action === "exclusions") {
        // Show modal to set exclusions (e.g. regions groups) as JSON string, to keep UI simple
        const modal = new ModalBuilder()
          .setCustomId(`rr:modal:exclusions:${menuId}`)
          .setTitle(`Set Role Exclusions`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("exclusions")
                .setLabel(`Enter exclusions JSON. Example:\n{"region": ["roleId1", "roleId2"]}`)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
            )
          );
        return interaction.showModal(modal);
      }
    }
  }

  // MODAL SUBMITS
  if (interaction.isModalSubmit()) {
    const [ctx, action, subAction, typeOrMenuId, maybeMenuId] = interaction.customId.split(":");

    if (ctx === "rr") {
      if (action === "modal") {
        if (subAction === "create") {
          // Create menu modal submission
          const name = interaction.fields.getTextInputValue("name");
          const desc = interaction.fields.getTextInputValue("desc");
          const menuId = db.createMenu(interaction.guild.id, name, desc);

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rr:type:dropdown:${menuId}`).setLabel("Use Dropdown").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`rr:type:button:${menuId}`).setLabel("Use Buttons").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`rr:type:both:${menuId}`).setLabel("Use Both").setStyle(ButtonStyle.Success)
          );

          return interaction.reply({ content: "Choose how users should select roles:", components: [row], flags: 64 });
        }

        if (subAction === "emojis") {
          const type = typeOrMenuId; // dropdown or button
          const menuId = maybeMenuId;

          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

          const raw = interaction.fields.getTextInputValue("emojis").trim();
          let emojis = [];

          if (raw.length > 0) {
            // Parse emojis separated by comma, trim spaces
            emojis = raw.split(",").map(s => s.trim());
          }

          // Save emojis array for the type, pad/truncate to roles length
          const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
          while (emojis.length < roles.length) emojis.push("");
          emojis = emojis.slice(0, roles.length);

          db.saveEmojis(menuId, emojis, type);

          return interaction.reply({ content: `✅ Emojis saved for ${type} roles.`, flags: 64 });
        }

        if (subAction === "limits") {
          const type = typeOrMenuId; // dropdown or button
          const menuId = maybeMenuId;
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

          let limitRaw = interaction.fields.getTextInputValue("limit");
          let limit = parseInt(limitRaw);
          if (isNaN(limit) || limit < 0) limit = 0;

          db.saveLimits(menuId, limit, type);

          return interaction.reply({ content: `✅ Role limit set to ${limit} for ${type}.`, flags: 64 });
        }

        if (subAction === "exclusions") {
          const menuId = typeOrMenuId;
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

          const raw = interaction.fields.getTextInputValue("exclusions").trim();
          let exclusions = {};
          if (raw.length > 0) {
            try {
              exclusions = JSON.parse(raw);
            } catch {
              return interaction.reply({ content: "❌ Invalid JSON format for exclusions.", flags: 64 });
            }
          }

          db.saveExclusions(menuId, exclusions);

          return interaction.reply({ content: "✅ Exclusions saved.", flags: 64 });
        }
      }
    }
  }

  // SELECT MENUS for roles selection
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith("rr:selectroles:")) {
      const [_, __, type, menuId] = interaction.customId.split(":");
      if (!interaction.values.length) return interaction.reply({ content: "❌ No roles selected.", flags: 64 });

      // Save roles
      db.saveRoles(menuId, interaction.values, type);

      // Check if need to select the other type roles
      const selectionType = db.getMenu(menuId).selectionType;
      const menu = db.getMenu(menuId);

      // Determine next type that still needs roles selected
      const needsDropdown = selectionType.includes("dropdown") && (!menu.dropdownRoles || !menu.dropdownRoles.length);
      const needsButton = selectionType.includes("button") && (!menu.buttonRoles || !menu.buttonRoles.length);
      let stillNeeds = null;
      if (needsDropdown && type !== "dropdown") stillNeeds = "dropdown";
      else if (needsButton && type !== "button") stillNeeds = "button";

      if (stillNeeds) {
        const allRoles = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);

        // Exclude roles already selected in the other type to avoid duplicates
        let options = allRoles;
        if (selectionType.length === 2) {
          const otherType = stillNeeds === "dropdown" ? "button" : "dropdown";
          const otherRoles = db.getMenu(menuId)[otherType + "Roles"] || [];
          options = allRoles.filter(r => !otherRoles.includes(r.id));
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId(`rr:selectroles:${stillNeeds}:${menuId}`)
          .setMinValues(1)
          .setMaxValues(Math.min(options.size, 25))
          .addOptions(options.map(r => ({ label: r.name, value: r.id })));

        return interaction.update({
          content: `✅ Saved roles for ${type}. Now select roles for **${stillNeeds}**:`,
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }

      // After roles selection done, show buttons to add emojis, set limits, exclusions, and publish
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rr:addemojis:dropdown:${menuId}`).setLabel("Add Dropdown Emojis").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`rr:addemojis:button:${menuId}`).setLabel("Add Button Emojis").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`rr:setlimits:dropdown:${menuId}`).setLabel("Set Dropdown Limit").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`rr:setlimits:button:${menuId}`).setLabel("Set Button Limit").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`rr:exclusions:${menuId}`).setLabel("Set Exclusions").setStyle(ButtonStyle.Danger)
      );

      const publishRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
      );

      return interaction.update({
        content: "✅ All roles saved. You can now add emojis, set limits, exclusions, or publish.",
        components: [row, publishRow],
      });
    }

    // User selecting roles from published dropdown menu
    if (interaction.customId.startsWith("rr:use:")) {
      const menuId = interaction.customId.split(":")[2];
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

      const chosen = interaction.values;
      const member = interaction.member;

      // Handle role limits and exclusions

      // Enforce dropdown limit
      if (menu.dropdownLimit > 0 && chosen.length > menu.dropdownLimit) {
        return interaction.reply({
          content: `❌ You can select up to ${menu.dropdownLimit} roles from this menu.`,
          flags: 64,
        });
      }

      // Enforce exclusions
      if (menu.exclusions) {
        // For each group in exclusions, ensure user only has one from that group after this selection
        for (const [groupName, roleIds] of Object.entries(menu.exclusions)) {
          const hasGroupRoles = roleIds.filter(rid => member.roles.cache.has(rid));
          const chosenInGroup = chosen.filter(rid => roleIds.includes(rid));
          if (chosenInGroup.length > 1) {
            return interaction.reply({
              content: `❌ You can only have one role from the "${groupName}" group.`,
              flags: 64,
            });
          }
          if (chosenInGroup.length === 1 && hasGroupRoles.length > 0 && !hasGroupRoles.includes(chosenInGroup[0])) {
            // Remove other roles in the group if conflicting
            for (const rId of hasGroupRoles) {
              await member.roles.remove(rId).catch(() => {});
            }
          }
        }
      }

      // Add new roles selected
      for (const roleId of menu.dropdownRoles) {
        if (chosen.includes(roleId)) {
          if (!member.roles.cache.has(roleId)) await member.roles.add(roleId).catch(() => {});
        } else {
          if (member.roles.cache.has(roleId)) await member.roles.remove(roleId).catch(() => {});
        }
      }

      return interaction.reply({ content: "✅ Your roles have been updated!", flags: 64 });
    }
  }

  // Button presses on published buttons
  if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
    const roleId = interaction.customId.split(":")[2];
    const member = interaction.member;
    const hasRole = member.roles.cache.has(roleId);

    if (hasRole) await member.roles.remove(roleId).catch(() => {});
    else await member.roles.add(roleId).catch(() => {});

    return interaction.reply({ content: `✅ You now ${hasRole ? "removed" : "added"} <@&${roleId}>`, flags: 64 });
  }
});

async function sendMainDashboard(interaction) {
  const embed = new EmbedBuilder().setTitle("🛠️ Server Dashboard").setDescription("Click a button to configure:");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("dash:reaction-roles").setLabel("Reaction Roles").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("dash:back").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true)
  );
  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function showReactionRolesDashboard(interaction) {
  const menus = db.getMenus(interaction.guild.id);
  const embed = new EmbedBuilder()
    .setTitle("🎨 Reaction Roles")
    .setDescription(menus.length ? menus.map((m, i) => `**${i + 1}.** ${m.name}`).join("\n") : "*No menus yet*");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rr:create").setLabel("➕ Create New").setStyle(ButtonStyle.Success),
    ...menus.map((m, i) => new ButtonBuilder().setCustomId(`rr:edit:${m.id}`).setLabel(`✏️ Edit ${i + 1}`).setStyle(ButtonStyle.Primary)),
    new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({ embeds: [embed], components: [row] });
}

async function publishMenu(interaction, menuId) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

  const embed = new EmbedBuilder().setTitle(menu.name).setDescription(menu.desc);
  const components = [];

  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    // Use emojis in dropdown options if present
    const options = menu.dropdownRoles.map((roleId, i) => {
      const role = interaction.guild.roles.cache.get(roleId);
      const emojiRaw = menu.dropdownEmojis[i] || null;
      let emoji = null;
      if (emojiRaw) {
        // Try to parse custom emoji: <a:name:id> or <:name:id>
        const customEmojiMatch = emojiRaw.match(/<(a?):(\w+):(\d+)>/);
        if (customEmojiMatch) {
          emoji = {
            id: customEmojiMatch[3],
            name: customEmojiMatch[2],
            animated: customEmojiMatch[1] === "a",
          };
        } else {
          // Unicode emoji fallback
          emoji = emojiRaw;
        }
      }
      return {
        label: role?.name || "Unknown",
        value: roleId,
        emoji,
      };
    });

    const dropdown = new StringSelectMenuBuilder()
      .setCustomId(`rr:use:${menuId}`)
      .setMinValues(0)
      .setMaxValues(menu.dropdownLimit > 0 ? menu.dropdownLimit : menu.dropdownRoles.length)
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(dropdown));
  }

  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    // Use emojis in button labels if present
    const buttons = menu.buttonRoles.map((roleId, i) => {
      const role = interaction.guild.roles.cache.get(roleId);
      const emojiRaw = menu.buttonEmojis[i] || null;
      let label = role?.name || "Unknown";
      let emoji = null;
      if (emojiRaw) {
        // Try custom emoji or unicode
        const customEmojiMatch = emojiRaw.match(/<(a?):(\w+):(\d+)>/);
        if (customEmojiMatch) {
          emoji = {
            id: customEmojiMatch[3],
            name: customEmojiMatch[2],
            animated: customEmojiMatch[1] === "a",
          };
        } else {
          emoji = emojiRaw;
        }
      }
      const btn = new ButtonBuilder()
        .setCustomId(`rr:assign:${roleId}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary);
      if (emoji) btn.setEmoji(emoji);
      return btn;
    });

    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  const msg = await interaction.channel.send({ embeds: [embed], components });
  db.saveMessageId(menuId, interaction.channel.id, msg.id);
  await interaction.update({ content: "🚀 Published!", components: [] });
}

client.login(process.env.TOKEN);
