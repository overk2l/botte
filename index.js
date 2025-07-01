// index.js (Full updated with emoji support & limits/exclusions)
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

// Simple in-memory DB (replace with your real DB if needed)
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
      dropdownEmojis: {}, // roleId -> emoji string
      buttonEmojis: {}, // roleId -> emoji string
      roleLimits: {}, // e.g. { max: 3 }
      exclusions: {}, // e.g. { region: [roleId1, roleId2] }
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
    if (type === "dropdown") this.menuData.get(menuId).dropdownRoles = roles;
    if (type === "button") this.menuData.get(menuId).buttonRoles = roles;
  },
  saveEmojis(menuId, emojis, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    if (type === "dropdown") menu.dropdownEmojis = emojis;
    if (type === "button") menu.buttonEmojis = emojis;
  },
  saveRoleLimits(menuId, limits) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.roleLimits = limits;
  },
  saveExclusions(menuId, exclusions) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.exclusions = exclusions;
  },
  saveSelectionType(menuId, types) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.selectionType = types;
  },
  getMenu(menuId) {
    return this.menuData.get(menuId);
  },
  saveMessageId(menuId, channelId, messageId) {
    const m = this.menuData.get(menuId);
    if (!m) return;
    m.channelId = channelId;
    m.messageId = messageId;
  },
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

// Helper: parse emoji string to discord.js Emoji object for buttons/selects
function parseEmoji(emoji) {
  if (!emoji) return undefined;
  // Custom emoji: <a:name:id> or <:name:id>
  const customEmojiRegex = /^<a?:([a-zA-Z0-9_]+):(\d+)>$/;
  const match = emoji.match(customEmojiRegex);
  if (match) {
    return {
      id: match[2],
      name: match[1],
      animated: emoji.startsWith("<a:"),
    };
  }
  // Unicode emoji fallback
  return { name: emoji };
}

// Helper: parse JSON safely with default fallback
function safeParseJSON(jsonStr, fallback) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return fallback;
  }
}

client.on("interactionCreate", async (interaction) => {
  try {
    // Slash command: /dashboard
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
      return sendMainDashboard(interaction);
    }

    // Button interactions
    if (interaction.isButton()) {
      const [ctx, action, extra, menuId] = interaction.customId.split(":");

      if (ctx === "dash") {
        if (action === "reaction-roles") return showReactionRolesDashboard(interaction);
        if (action === "back") return sendMainDashboard(interaction);
      }

      if (ctx === "rr") {
        if (action === "create") {
          // New Reaction Role modal: Name, Description
          const modal = new ModalBuilder()
            .setCustomId("rr:modal:create")
            .setTitle("New Reaction Role Menu")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("name")
                  .setLabel("Menu Name")
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(45)
                  .setRequired(true)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("desc")
                  .setLabel("Embed Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setMaxLength(1000)
                  .setRequired(false)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "type") {
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(menuId, selectedTypes);

          // Start role selection with dropdown first if selected, else buttons
          const nextType = selectedTypes.includes("dropdown") ? "dropdown" : "button";
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${nextType}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.update({
            content: `✅ Selection type saved. Now select roles for **${nextType}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }

        if (action === "publish") {
          if (!menuId) return interaction.reply({ content: "Menu ID missing for publish.", ephemeral: true });
          return publishMenu(interaction, menuId);
        }

        if (action === "add-emojis") {
          // Show modal to add emojis to either dropdown or buttons roles
          if (!menuId || !extra) return interaction.reply({ content: "Missing data for emojis.", ephemeral: true });

          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          // Get roles for selected type
          const roles = extra === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
          if (!roles.length) return interaction.reply({ content: `No roles found for ${extra} to add emojis to.`, ephemeral: true });

          // Build modal with one text input per role for emoji
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:addemojis:${extra}:${menuId}`)
            .setTitle(`Add Emojis for ${extra} roles`);

          // Discord modals max 5 components, so chunk roles into groups of 5
          // But for simplicity, just add max 5 inputs, user can do multiple times if needed
          for (let i = 0; i < Math.min(roles.length, 5); i++) {
            const roleId = roles[i];
            const role = interaction.guild.roles.cache.get(roleId);
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(roleId)
                  .setLabel(`Emoji for ${role ? role.name : roleId} (unicode or <:name:id>)`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setMaxLength(50)
              )
            );
          }

          return interaction.showModal(modal);
        }

        if (action === "set-limits") {
          // Modal to input role limits, e.g. max roles user can select
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setlimits:${menuId}`)
            .setTitle("Set Role Limits")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("maxRoles")
                  .setLabel("Max roles selectable (0 = no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("e.g. 3")
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "set-exclusions") {
          // Modal to input exclusions JSON
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setexclusions:${menuId}`)
            .setTitle("Set Role Exclusions (JSON)")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("exclusionsJSON")
                  .setLabel('Enter exclusions JSON. Example: {"region": ["roleId1", "roleId2"]}')
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder('{}')
                  .setMaxLength(1000)
              )
            );
          return interaction.showModal(modal);
        }
      }
    }

    // Modal submits
    if (interaction.isModalSubmit()) {
      const [ctx, type, subType, menuId] = interaction.customId.split(":");

      if (ctx === "rr") {
        if (type === "modal") {
          if (subType === "create") {
            const name = interaction.fields.getTextInputValue("name").trim();
            const desc = interaction.fields.getTextInputValue("desc").trim();
            if (!name) return interaction.reply({ content: "Menu name is required.", ephemeral: true });

            const menuIdNew = db.createMenu(interaction.guild.id, name, desc);
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`rr:type:dropdown:${menuIdNew}`).setLabel("Use Dropdown").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`rr:type:button:${menuIdNew}`).setLabel("Use Buttons").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`rr:type:both:${menuIdNew}`).setLabel("Use Both").setStyle(ButtonStyle.Success)
            );

            return interaction.reply({
              content: `Menu created with ID: **${menuIdNew}**. Choose how users should select roles:`,
              components: [row],
              ephemeral: true,
            });
          }

          if (subType === "addemojis") {
            const type = interaction.customId.split(":")[3]; // dropdown or button
            if (!menuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });

            const menu = db.getMenu(menuId);
            if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

            // Collect emoji inputs from modal
            const emojis = {};
            for (const [key, value] of interaction.fields.fields) {
              // key = roleId, value = emoji string (or empty)
              emojis[key] = value.value.trim() || null;
            }

            // Save emojis accordingly
            if (type === "dropdown") {
              menu.dropdownEmojis = { ...menu.dropdownEmojis, ...emojis };
              db.saveEmojis(menuId, menu.dropdownEmojis, "dropdown");
            } else if (type === "button") {
              menu.buttonEmojis = { ...menu.buttonEmojis, ...emojis };
              db.saveEmojis(menuId, menu.buttonEmojis, "button");
            }

            return interaction.reply({ content: `✅ Emojis saved for ${type} roles.`, ephemeral: true });
          }

          if (subType === "setlimits") {
            if (!menuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });

            const maxRolesRaw = interaction.fields.getTextInputValue("maxRoles").trim();
            const maxRoles = parseInt(maxRolesRaw, 10);
            if (isNaN(maxRoles) || maxRoles < 0) return interaction.reply({ content: "Invalid max roles number.", ephemeral: true });

            const menu = db.getMenu(menuId);
            if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

            menu.roleLimits.max = maxRoles;
            db.saveRoleLimits(menuId, menu.roleLimits);

            return interaction.reply({ content: `✅ Role limits saved. Max roles: ${maxRoles}`, ephemeral: true });
          }

          if (subType === "setexclusions") {
            if (!menuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });

            const exclusionsRaw = interaction.fields.getTextInputValue("exclusionsJSON").trim();
            const exclusions = safeParseJSON(exclusionsRaw, {});

            if (typeof exclusions !== "object" || exclusions === null) {
              return interaction.reply({ content: "Invalid exclusions JSON.", ephemeral: true });
            }

            const menu = db.getMenu(menuId);
            if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

            menu.exclusions = exclusions;
            db.saveExclusions(menuId, exclusions);

            return interaction.reply({ content: "✅ Exclusions saved.", ephemeral: true });
          }
        }
      }
    }

    // Role selection dropdown use
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:selectroles:")) {
      const [_, __, type, menuId] = interaction.customId.split(":");
      if (!interaction.values.length) return interaction.reply({ content: "❌ No roles selected.", ephemeral: true });

      db.saveRoles(menuId, interaction.values, type);

      const menu = db.getMenu(menuId);
      const selectionType = menu.selectionType;

      // Next needed selection type?
      const stillNeeds = selectionType.includes("dropdown") && menu.dropdownRoles.length === 0
        ? "dropdown"
        : selectionType.includes("button") && menu.buttonRoles.length === 0
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

      // Once all roles are selected, show buttons for adding emojis, limits, exclusions, publish
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rr:add-emojis:dropdown:${menuId}`).setLabel("Add Emojis (Dropdown)").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`rr:add-emojis:button:${menuId}`).setLabel("Add Emojis (Buttons)").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`rr:set-limits:${menuId}`).setLabel("Set Role Limits").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`rr:set-exclusions:${menuId}`).setLabel("Set Exclusions").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Success)
      );

      return interaction.update({ content: "✅ All roles saved. Configure emojis, limits or publish below.", components: [row] });
    }

    // Role usage dropdown (user selects roles)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:use:")) {
      const menuId = interaction.customId.split(":")[2];
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

      const chosen = interaction.values;
      const member = interaction.member;

      // Handle role limits and exclusions before assigning
      const maxRoles = menu.roleLimits?.max || 0;
      const exclusions = menu.exclusions || {};

      // Compute current user roles in dropdown & buttons
      const userRoles = member.roles.cache;

      // Function to remove excluded roles if new role selected
      function applyExclusions(newRoleId) {
        for (const group in exclusions) {
          const groupRoles = exclusions[group];
          if (groupRoles.includes(newRoleId)) {
            for (const rId of groupRoles) {
              if (rId !== newRoleId && userRoles.has(rId)) {
                member.roles.remove(rId).catch(() => { });
              }
            }
          }
        }
      }

      // Check max roles limit for this menu (dropdown roles)
      let selectedCount = chosen.length;
      if (maxRoles > 0 && selectedCount > maxRoles) {
        return interaction.reply({
          content: `❌ You can select up to ${maxRoles} roles only.`,
          ephemeral: true,
        });
      }

      // Assign and remove dropdown roles based on selection with exclusions applied
      for (const roleId of menu.dropdownRoles) {
        if (chosen.includes(roleId)) {
          if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId);
            applyExclusions(roleId);
          }
        } else {
          if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
        }
      }

      return interaction.reply({ content: "✅ Your roles have been updated!", ephemeral: true });
    }

    // Button role assign/unassign
    if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
      const roleId = interaction.customId.split(":")[2];
      const menuId = [...db.menuData.entries()].find(([k, v]) => v.buttonRoles.includes(roleId))?.[0];
      if (!menuId) return interaction.reply({ content: "Role menu not found.", ephemeral: true });

      const menu = db.getMenu(menuId);
      const member = interaction.member;
      const hasRole = member.roles.cache.has(roleId);
      const maxRoles = menu.roleLimits?.max || 0;
      const exclusions = menu.exclusions || {};

      // If max roles limit is set, check how many button roles user has
      const currentButtonRolesCount = menu.buttonRoles.filter((rId) => member.roles.cache.has(rId)).length;

      if (!hasRole) {
        if (maxRoles > 0 && currentButtonRolesCount >= maxRoles) {
          return interaction.reply({
            content: `❌ You can have up to ${maxRoles} button roles only.`,
            ephemeral: true,
          });
        }
        await member.roles.add(roleId);
        // Apply exclusions
        for (const group in exclusions) {
          const groupRoles = exclusions[group];
          if (groupRoles.includes(roleId)) {
            for (const rId of groupRoles) {
              if (rId !== roleId && member.roles.cache.has(rId)) {
                await member.roles.remove(rId).catch(() => { });
              }
            }
          }
        }
        return interaction.reply({ content: `✅ Role ${interaction.guild.roles.cache.get(roleId)?.name || roleId} added!`, ephemeral: true });
      } else {
        await member.roles.remove(roleId);
        return interaction.reply({ content: `✅ Role ${interaction.guild.roles.cache.get(roleId)?.name || roleId} removed!`, ephemeral: true });
      }
    }
  } catch (err) {
    console.error("Error handling interaction:", err);
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: `❌ Something went wrong: ${err.message}`, ephemeral: true }).catch(() => {});
    } else {
      interaction.reply({ content: `❌ Something went wrong: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  }
});

// Publish the menu with emoji support on dropdown & buttons
async function publishMenu(interaction, menuId) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

  const embed = new EmbedBuilder().setTitle(menu.name).setDescription(menu.desc);

  const components = [];

  // Dropdown component
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const options = menu.dropdownRoles
      .map((roleId) => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        const emojiStr = menu.dropdownEmojis[roleId];
        return {
          label: role.name,
          value: role.id,
          emoji: emojiStr ? parseEmoji(emojiStr) : undefined,
        };
      })
      .filter(Boolean);

    if (options.length) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`rr:use:${menuId}`)
        .setMinValues(0)
        .setMaxValues(options.length)
        .addOptions(options);

      components.push(new ActionRowBuilder().addComponents(select));
    }
  }

  // Buttons component
  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const buttons = menu.buttonRoles
      .map((roleId) => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        const emojiStr = menu.buttonEmojis[roleId];
        const button = new ButtonBuilder()
          .setCustomId(`rr:assign:${roleId}`)
          .setLabel(role.name)
          .setStyle(ButtonStyle.Primary);

        if (emojiStr) {
          try {
            button.setEmoji(parseEmoji(emojiStr));
          } catch {
            // ignore emoji errors
          }
        }
        return button;
      })
      .filter(Boolean);

    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  if (components.length === 0)
    return interaction.reply({ content: "No roles selected to publish.", ephemeral: true });

  const msg = await interaction.channel.send({ embeds: [embed], components });

  db.saveMessageId(menuId, interaction.channel.id, msg.id);

  return interaction.reply({ content: "🚀 Reaction role menu published!", ephemeral: true });
}

// Initial main dashboard with buttons
async function sendMainDashboard(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dash:reaction-roles")
      .setLabel("Manage Reaction Roles")
      .setStyle(ButtonStyle.Primary)
  );
  await interaction.reply({
    content: "Dashboard - Select a panel:",
    components: [row],
    ephemeral: true,
  });
}

// Reaction roles dashboard showing existing menus or create button
async function showReactionRolesDashboard(interaction) {
  const menus = db.getMenus(interaction.guild.id);
  let description = "";
  if (menus.length === 0) {
    description = "No reaction role menus found. Create a new one!";
  } else {
    description = menus.map((m) => `• **${m.name}** (ID: ${m.id})`).join("\n");
  }

  const embed = new EmbedBuilder()
    .setTitle("Reaction Role Menus")
    .setDescription(description)
    .setColor(0x00aeef);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rr:create")
      .setLabel("Create New Menu")
      .setStyle(ButtonStyle.Success)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

client.login(process.env.TOKEN);
