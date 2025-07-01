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
      dropdownEmojis: {},   // key: roleId, value: emoji string
      buttonEmojis: {},     // key: roleId, value: emoji string
      roleLimits: {},       // key: roleId, value: limit number
      exclusions: {},       // e.g. { region: [roleId1, roleId2] }
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
  saveRoleLimits(menuId, limits) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.roleLimits = { ...menu.roleLimits, ...limits };
  },
  saveExclusions(menuId, exclusions) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.exclusions = exclusions;
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
      const [ctx, action, extra, menuId] = interaction.customId.split(":");

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
          if (!extra) return interaction.reply({ content: "Menu ID missing for publish.", ephemeral: true });
          return publishMenu(interaction, extra);
        }

        if (action === "type") {
          if (!menuId) return interaction.reply({ content: "Menu ID missing for selection type.", ephemeral: true });
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(menuId, selectedTypes);

          // Start with dropdown roles selection if included
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

        if (action === "addemoji") {
          // Show modal to add emojis to roles for dropdown or button
          if (!menuId || !extra) return interaction.reply({ content: "Menu ID or type missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          // Prepare modal with text inputs per role for emojis
          const type = extra; // dropdown or button
          const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
          if (!roles.length) return interaction.reply({ content: `No roles found for ${type}.`, ephemeral: true });

          const modal = new ModalBuilder().setCustomId(`rr:modal:addemoji:${type}:${menuId}`).setTitle(`Add Emojis for ${type}`);

          // Discord limits max 5 action rows per modal
          // So max 5 roles at once — ideally extend with paginated modals but keep simple here
          const maxInputs = Math.min(roles.length, 5);
          for (let i = 0; i < maxInputs; i++) {
            const roleId = roles[i];
            const role = interaction.guild.roles.cache.get(roleId);
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(roleId)
                  .setLabel(`Emoji for ${role ? role.name : "Unknown Role"}`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("Enter emoji here")
              )
            );
          }
          return interaction.showModal(modal);
        }

        if (action === "setlimits") {
          // Show modal to set role limits
          if (!menuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });
          const allRoles = [...new Set([...menu.dropdownRoles, ...menu.buttonRoles])];
          if (!allRoles.length) return interaction.reply({ content: "No roles to set limits on.", ephemeral: true });

          const modal = new ModalBuilder().setCustomId(`rr:modal:setlimits:${menuId}`).setTitle("Set Role Limits");

          const maxInputs = Math.min(allRoles.length, 5);
          for (let i = 0; i < maxInputs; i++) {
            const roleId = allRoles[i];
            const role = interaction.guild.roles.cache.get(roleId);
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(roleId)
                  .setLabel(`Limit for ${role ? role.name : "Unknown Role"}`)
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("Enter max number or leave blank")
                  .setRequired(false)
              )
            );
          }
          return interaction.showModal(modal);
        }

        if (action === "setexclusions") {
          // Show modal to set exclusions JSON
          if (!menuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setexclusions:${menuId}`)
            .setTitle("Set Role Exclusions")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("exclusions")
                  .setLabel("Exclusions JSON (example: {\"region\": [\"roleId1\", \"roleId2\"]})")
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('{"region": ["roleId1", "roleId2"]}')
                  .setRequired(false)
              )
            );
          return interaction.showModal(modal);
        }
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "create") {
        // Create menu from modal input
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
        // Save emojis from modal input
        const type = parts[3]; // dropdown or button
        const menuId = parts[4];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const emojis = {};
        for (const [key, input] of interaction.fields.fields) {
          const val = input.value;
          if (typeof val === "string" && val.trim()) {
            emojis[key] = val.trim();
          }
        }
        db.saveEmojis(menuId, emojis, type);
        return interaction.reply({ content: `✅ Emojis saved for ${type}.`, ephemeral: true });
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "setlimits") {
        const menuId = parts[3];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const limits = {};
        for (const [key, input] of interaction.fields.fields) {
          const val = input.value;
          if (val && !isNaN(val)) limits[key] = Number(val);
        }
        db.saveRoleLimits(menuId, limits);
        return interaction.reply({ content: "✅ Role limits saved.", ephemeral: true });
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "setexclusions") {
        const menuId = parts[3];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        let exclusions;
        try {
          const raw = interaction.fields.getTextInputValue("exclusions");
          exclusions = raw ? JSON.parse(raw) : {};
        } catch {
          return interaction.reply({ content: "❌ Invalid JSON format.", ephemeral: true });
        }
        db.saveExclusions(menuId, exclusions);
        return interaction.reply({ content: "✅ Exclusions saved.", ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("rr:selectroles:")) {
        // Save selected roles per type (dropdown/button)
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

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({ content: "✅ All roles saved. Click Publish to post.", components: [row] });
      }

      if (interaction.customId.startsWith("rr:use:")) {
        // Handle dropdown role selection by users
        const menuId = interaction.customId.split(":")[2];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const chosen = interaction.values;
        const member = interaction.member;

        // Remove roles excluded by exclusions logic (basic example)
        // You can extend exclusions logic here if you want complex mutual exclusives

        // Remove roles not chosen that user has from dropdownRoles
        for (const roleId of menu.dropdownRoles) {
          if (chosen.includes(roleId)) {
            if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
          } else {
            if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
          }
        }

        // Check limits (optional advanced feature to implement if needed)
        // For now, just allow selection

        return interaction.reply({ content: "✅ Your roles have been updated!", ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
      // Handle button role assign/remove
      const roleId = interaction.customId.split(":")[2];
      const member = interaction.member;
      const hasRole = member.roles.cache.has(roleId);

      // Exclusions and limits logic can be added here if you want

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
  const embed = new EmbedBuilder().setTitle("🛠️ Server Dashboard").setDescription("Click a button to configure:");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("dash:reaction-roles").setLabel("Reaction Roles").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("dash:back").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true)
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
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
  if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

  // Create embed
  const embed = new EmbedBuilder().setTitle(menu.name).setDescription(menu.desc);

  const components = [];

  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const options = menu.dropdownRoles.map((roleId) => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return null;
      const emoji = menu.dropdownEmojis[roleId] || null;
      return {
        label: role.name,
        value: role.id,
        emoji: emoji ? { name: emoji } : undefined,
      };
    }).filter(Boolean);

    if (options.length) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`rr:use:${menuId}`)
        .setMinValues(0)
        .setMaxValues(options.length)
        .addOptions(options);
      components.push(new ActionRowBuilder().addComponents(select));
    }
  }

  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const buttons = menu.buttonRoles.map((roleId) => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return null;
      const emoji = menu.buttonEmojis[roleId];
      const button = new ButtonBuilder()
        .setCustomId(`rr:assign:${roleId}`)
        .setLabel(role.name)
        .setStyle(ButtonStyle.Primary);
      if (emoji) {
        try {
          button.setEmoji(emoji);
        } catch {
          // fallback if invalid emoji
        }
      }
      return button;
    }).filter(Boolean);

    if (buttons.length) {
      // Discord max 5 buttons per row, so split if needed
      for (let i = 0; i < buttons.length; i += 5) {
        components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }
    }
  }

  if (components.length === 0) return interaction.reply({ content: "No roles selected to publish.", ephemeral: true });

  const message = await interaction.channel.send({ embeds: [embed], components });
  db.saveMessageId(menuId, interaction.channel.id, message.id);

  return interaction.reply({ content: "🚀 Reaction role menu published!", ephemeral: true });
}

client.login(process.env.TOKEN);
