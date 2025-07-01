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
      emojis: { dropdown: {}, button: {} },
      exclusions: {},
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
    else if (type === "button") this.menuData.get(menuId).buttonRoles = roles;
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
  },
  saveEmojis(menuId, emojis, type) {
    this.menuData.get(menuId).emojis[type] = emojis;
  },
  saveExclusions(menuId, exclusions) {
    this.menuData.get(menuId).exclusions = exclusions;
  }
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST().setToken(process.env.TOKEN);
  const cmd = new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Open the guild dashboard")
    .toJSON();
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [cmd] }
  );
  console.log("📑 /dashboard command deployed");
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard")
      return sendMainDashboard(interaction);

    if (interaction.isButton()) {
      const [ctx, action, extra, menuId] = interaction.customId.split(":");

      if (ctx === "dash") {
        if (action === "reaction-roles") return showReactionRolesDashboard(interaction);
        if (action === "back") return sendMainDashboard(interaction);
      }

      if (ctx === "rr") {
        if (action === "create") {
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
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("desc")
                  .setLabel("Embed Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setMaxLength(4000)
              )
            );
          return await interaction.showModal(modal);
        }

        if (action === "publish") return publishMenu(interaction, extra);

        if (action === "type") {
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(menuId, selectedTypes);

          // Start selecting roles for dropdown first if included, else buttons
          const nextType = selectedTypes.includes("dropdown")
            ? "dropdown"
            : "button";
          const allRoles = interaction.guild.roles.cache.filter(
            (r) => !r.managed && r.id !== interaction.guild.id
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${nextType}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(
              allRoles.map((r) => ({
                label: r.name,
                value: r.id,
              }))
            );

          return interaction.update({
            content: `✅ Selection type saved. Now select roles for **${nextType}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "rr:modal:create") {
        const name = interaction.fields.getTextInputValue("name");
        const desc = interaction.fields.getTextInputValue("desc");
        const menuId = db.createMenu(interaction.guild.id, name, desc);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rr:type:dropdown:${menuId}`)
            .setLabel("Use Dropdown")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`rr:type:button:${menuId}`)
            .setLabel("Use Buttons")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`rr:type:both:${menuId}`)
            .setLabel("Use Both")
            .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({
          content: "Choose how users should select roles:",
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith("rr:modal:emojis:")) {
        // Modal for setting emojis for dropdown or buttons roles
        // Format: rr:modal:emojis:<type>:<menuId>
        const [, , , type, menuId] = interaction.customId.split(":");
        const menu = db.getMenu(menuId);
        if (!menu)
          return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

        // Expecting JSON string with roleId to emoji mapping
        const emojisRaw = interaction.fields.getTextInputValue("emojis");
        let emojis = {};
        try {
          emojis = JSON.parse(emojisRaw);
        } catch {
          return interaction.reply({
            content: "❌ Invalid JSON for emojis.",
            ephemeral: true,
          });
        }

        db.saveEmojis(menuId, emojis, type);
        return interaction.reply({
          content: `✅ Emojis saved for ${type}.`,
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith("rr:modal:exclusions:")) {
        // Modal for setting exclusions JSON
        const [, , , menuId] = interaction.customId.split(":");
        const menu = db.getMenu(menuId);
        if (!menu)
          return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

        const exclusionsRaw = interaction.fields.getTextInputValue("exclusions");
        let exclusions = {};
        try {
          exclusions = JSON.parse(exclusionsRaw);
        } catch {
          return interaction.reply({
            content:
              '❌ Invalid JSON for exclusions. Example: {"region": ["roleId1", "roleId2"]}',
            ephemeral: true,
          });
        }

        db.saveExclusions(menuId, exclusions);
        return interaction.reply({
          content: "✅ Exclusions saved.",
          ephemeral: true,
        });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:selectroles:")) {
      const [_, __, type, menuId] = interaction.customId.split(":");
      if (!interaction.values.length)
        return interaction.reply({ content: "❌ No roles selected.", ephemeral: true });

      db.saveRoles(menuId, interaction.values, type);

      // Check if other type is needed
      const selectionType = db.getMenu(menuId).selectionType;
      const needDropdown = selectionType.includes("dropdown") && !db.getMenu(menuId).dropdownRoles.length;
      const needButton = selectionType.includes("button") && !db.getMenu(menuId).buttonRoles.length;

      if (needDropdown) {
        const allRoles = interaction.guild.roles.cache.filter(
          (r) => !r.managed && r.id !== interaction.guild.id
        );
        const select = new StringSelectMenuBuilder()
          .setCustomId(`rr:selectroles:dropdown:${menuId}`)
          .setMinValues(1)
          .setMaxValues(Math.min(allRoles.size, 25))
          .addOptions(
            allRoles.map((r) => ({
              label: r.name,
              value: r.id,
            }))
          );

        return interaction.update({
          content: `✅ Saved roles for ${type}. Now select roles for **dropdown**:`,
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }
      if (needButton) {
        const allRoles = interaction.guild.roles.cache.filter(
          (r) => !r.managed && r.id !== interaction.guild.id
        );
        const select = new StringSelectMenuBuilder()
          .setCustomId(`rr:selectroles:button:${menuId}`)
          .setMinValues(1)
          .setMaxValues(Math.min(allRoles.size, 25))
          .addOptions(
            allRoles.map((r) => ({
              label: r.name,
              value: r.id,
            }))
          );

        return interaction.update({
          content: `✅ Saved roles for ${type}. Now select roles for **button**:`,
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rr:publish:${menuId}`)
          .setLabel("🚀 Publish")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("dash:back")
          .setLabel("🔙 Back")
          .setStyle(ButtonStyle.Secondary)
      );
      return interaction.update({
        content: "✅ All roles saved. Click Publish to post.",
        components: [row],
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:use:")) {
      const menuId = interaction.customId.split(":")[2];
      const menu = db.getMenu(menuId);
      if (!menu)
        return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

      const chosen = interaction.values;
      const member = interaction.member;

      // Handle exclusions if any
      if (menu.exclusions) {
        for (const groupKey in menu.exclusions) {
          if (!menu.exclusions.hasOwnProperty(groupKey)) continue;
          const rolesInGroup = menu.exclusions[groupKey];
          // If user selects one role from group, remove other roles in same group
          for (const roleId of rolesInGroup) {
            if (chosen.includes(roleId)) {
              for (const otherRoleId of rolesInGroup) {
                if (otherRoleId !== roleId && member.roles.cache.has(otherRoleId)) {
                  await member.roles.remove(otherRoleId).catch(() => {});
                }
              }
            }
          }
        }
      }

      for (const roleId of menu.dropdownRoles) {
        if (chosen.includes(roleId)) {
          if (!member.roles.cache.has(roleId)) await member.roles.add(roleId).catch(() => {});
        } else {
          if (member.roles.cache.has(roleId)) await member.roles.remove(roleId).catch(() => {});
        }
      }

      return interaction.reply({
        content: "✅ Your roles have been updated!",
        ephemeral: true,
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
      const roleId = interaction.customId.split(":")[2];
      const member = interaction.member;
      const hasRole = member.roles.cache.has(roleId);

      if (hasRole) await member.roles.remove(roleId).catch(() => {});
      else await member.roles.add(roleId).catch(() => {});

      return interaction.reply({
        content: `✅ You have ${
          hasRole ? "removed" : "added"
        } <@&${roleId}>.`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("Error in interactionCreate:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "❌ An error occurred.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "❌ An error occurred.",
        ephemeral: true,
      });
    }
  }
});

async function sendMainDashboard(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("🛠️ Server Dashboard")
    .setDescription("Click a button to configure:");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dash:reaction-roles")
      .setLabel("Reaction Roles")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("dash:back")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function showReactionRolesDashboard(interaction) {
  const menus = db.getMenus(interaction.guild.id);
  const embed = new EmbedBuilder()
    .setTitle("🎨 Reaction Roles")
    .setDescription(menus.length ? menus.map((m, i) => `**${i + 1}.** ${m.name}`).join("\n") : "*No menus yet*");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rr:create")
      .setLabel("➕ Create New")
      .setStyle(ButtonStyle.Success),
    ...menus.map((m, i) =>
      new ButtonBuilder()
        .setCustomId(`rr:edit:${m.id}`)
        .setLabel(`✏️ Edit ${i + 1}`)
        .setStyle(ButtonStyle.Primary)
    ),
    new ButtonBuilder()
      .setCustomId("dash:back")
      .setLabel("🔙 Back")
      .setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({ embeds: [embed], components: [row] });
}

async function publishMenu(interaction, menuId) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

  const embed = new EmbedBuilder().setTitle(menu.name).setDescription(menu.desc);
  const components = [];

  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const dropdown = new StringSelectMenuBuilder()
      .setCustomId(`rr:use:${menuId}`)
      .setMinValues(0)
      .setMaxValues(menu.dropdownRoles.length)
      .addOptions(
        menu.dropdownRoles.map((roleId) => {
          const role = interaction.guild.roles.cache.get(roleId);
          const emoji = menu.emojis.dropdown?.[roleId];
          return {
            label: role?.name || "Unknown",
            value: roleId,
            emoji: emoji ? { name: emoji } : undefined,
          };
        })
      );
    components.push(new ActionRowBuilder().addComponents(dropdown));
  }

  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const buttons = menu.buttonRoles.map((roleId) => {
      const role = interaction.guild.roles.cache.get(roleId);
      const emoji = menu.emojis.button?.[roleId];
      return new ButtonBuilder()
        .setCustomId(`rr:assign:${roleId}`)
        .setLabel(role?.name || "Unknown")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emoji || null);
    });

    // Buttons max 5 per row
    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  const msg = await interaction.channel.send({ embeds: [embed], components });
  db.saveMessageId(menuId, interaction.channel.id, msg.id);

  // Proper interaction response to avoid failure
  await interaction.deferUpdate();
  await interaction.followUp({ content: "🚀 Published!", ephemeral: true });
}

client.login(process.env.TOKEN);
