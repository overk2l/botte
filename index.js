// index.js (Updated: Dropdown + Button role separation + menuId fixes + emoji optional + exclusions handled)
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
      exclusions: {},
      channelId: null,
      messageId: null,
      limits: { dropdown: 25, button: 25 }, // default limits
      emojis: { dropdown: {}, button: {} }, // store emojis by roleId
    });
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map((id) => ({ id, ...this.menuData.get(id) }));
  },
  saveRoles(menuId, roles, type) {
    if (type === "dropdown") this.menuData.get(menuId).dropdownRoles = roles;
    if (type === "button") this.menuData.get(menuId).buttonRoles = roles;
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
  saveEmojis(menuId, type, emojis) {
    const m = this.menuData.get(menuId);
    m.emojis[type] = emojis;
  },
  saveExclusions(menuId, exclusions) {
    const m = this.menuData.get(menuId);
    m.exclusions = exclusions;
  },
  saveLimits(menuId, limits) {
    const m = this.menuData.get(menuId);
    m.limits = limits;
  },
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
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
  console.log("📑 /dashboard command deployed");
});

client.on("interactionCreate", async (interaction) => {
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
        // Modal for new menu creation
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

      if (action === "publish") return publishMenu(interaction, extra);

      if (action === "type") {
        // Save selection type and ask for roles for first type
        let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
        db.saveSelectionType(menuId, selectedTypes);

        // Pick next type to select roles for
        const nextType = selectedTypes[0];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

        const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
        const limit = menu.limits[nextType] || 25;

        const select = new StringSelectMenuBuilder()
          .setCustomId(`rr:selectroles:${nextType}:${menuId}`)
          .setMinValues(1)
          .setMaxValues(Math.min(limit, allRoles.size, 25))
          .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })).slice(0, 25));

        return interaction.update({
          content: `✅ Selection type saved. Now select roles for **${nextType}**:`,
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }
    }

    if (ctx === "rr" && action === "setemojis") {
      // Example: Show modal to input emojis JSON for given type
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

      const modal = new ModalBuilder()
        .setCustomId(`rr:modal:emojis:${menuId}`)
        .setTitle(`Set emojis for ${extra} roles`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("emojis")
              .setLabel('Enter emojis JSON (roleId: emoji), e.g. {"roleId1": "😀", "roleId2": "🔥"}')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
          )
        );
      return interaction.showModal(modal);
    }

    if (ctx === "rr" && action === "setexclusions") {
      // Show modal to input exclusions JSON
      const modal = new ModalBuilder()
        .setCustomId(`rr:modal:exclusions:${menuId}`)
        .setTitle(`Set exclusions JSON`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("exclusions")
              .setLabel('Enter exclusions JSON, e.g. {"region": ["roleId1", "roleId2"]}')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
          )
        );
      return interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === "rr:modal:create") {
      const name = interaction.fields.getTextInputValue("name");
      const desc = interaction.fields.getTextInputValue("desc");
      const newMenuId = db.createMenu(interaction.guild.id, name, desc);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rr:type:dropdown:${newMenuId}`)
          .setLabel("Use Dropdown")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rr:type:button:${newMenuId}`)
          .setLabel("Use Buttons")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rr:type:both:${newMenuId}`)
          .setLabel("Use Both")
          .setStyle(ButtonStyle.Success)
      );

      return interaction.reply({ content: "Choose how users should select roles:", components: [row], flags: 64 });
    }

    if (interaction.customId.startsWith("rr:modal:emojis:")) {
      const menuId = interaction.customId.split(":")[3];
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

      const emojisRaw = interaction.fields.getTextInputValue("emojis").trim();
      let emojis = {};
      if (emojisRaw) {
        try {
          emojis = JSON.parse(emojisRaw);
        } catch {
          return interaction.reply({ content: "❌ Invalid JSON for emojis.", flags: 64 });
        }
      }
      db.saveEmojis(menuId, menu.selectionType.length ? menu.selectionType[0] : "dropdown", emojis);

      return interaction.reply({ content: "✅ Emojis saved.", flags: 64 });
    }

    if (interaction.customId.startsWith("rr:modal:exclusions:")) {
      const menuId = interaction.customId.split(":")[3];
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

      const exclusionsRaw = interaction.fields.getTextInputValue("exclusions").trim();
      let exclusions = {};
      if (exclusionsRaw) {
        try {
          exclusions = JSON.parse(exclusionsRaw);
        } catch {
          return interaction.reply({ content: "❌ Invalid JSON for exclusions.", flags: 64 });
        }
      }
      db.saveExclusions(menuId, exclusions);
      return interaction.reply({ content: "✅ Exclusions saved.", flags: 64 });
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith("rr:selectroles:")) {
      // Selecting roles for dropdown or buttons during creation
      const [_, __, type, menuId] = interaction.customId.split(":");
      if (!interaction.values.length) return interaction.reply({ content: "❌ No roles selected.", flags: 64 });

      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

      db.saveRoles(menuId, interaction.values, type);

      const selectionType = menu.selectionType;
      const stillNeeds = selectionType.includes("dropdown") && !menu.dropdownRoles.length ? "dropdown"
        : selectionType.includes("button") && !menu.buttonRoles.length ? "button"
        : null;

      if (stillNeeds) {
        const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
        const limit = menu.limits[stillNeeds] || 25;

        const select = new StringSelectMenuBuilder()
          .setCustomId(`rr:selectroles:${stillNeeds}:${menuId}`)
          .setMinValues(1)
          .setMaxValues(Math.min(limit, allRoles.size, 25))
          .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })).slice(0, 25));

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
      // User uses dropdown to select roles
      const menuId = interaction.customId.split(":")[2];
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

      const chosen = interaction.values;
      const member = interaction.member;

      // Handle exclusions if defined
      if (menu.exclusions) {
        for (const groupKey of Object.keys(menu.exclusions)) {
          const groupRoles = menu.exclusions[groupKey]; // roles that exclude each other
          // If member selects one role in group, remove other roles from group
          for (const roleId of groupRoles) {
            if (chosen.includes(roleId)) {
              for (const otherRoleId of groupRoles) {
                if (otherRoleId !== roleId && member.roles.cache.has(otherRoleId)) {
                  await member.roles.remove(otherRoleId).catch(() => {});
                }
              }
            }
          }
        }
      }

      // Assign roles from dropdown
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

  if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
    const roleId = interaction.customId.split(":")[2];
    const member = interaction.member;

    const menuId = [...db.menuData.entries()].find(([id, menu]) => {
      return menu.buttonRoles.includes(roleId);
    })?.[0];

    if (!menuId) return interaction.reply({ content: "❌ Role not associated with any menu.", flags: 64 });

    const menu = db.getMenu(menuId);
    if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

    // Remove excluded roles when adding one
    if (menu.exclusions) {
      for (const groupKey of Object.keys(menu.exclusions)) {
        const groupRoles = menu.exclusions[groupKey];
        if (groupRoles.includes(roleId)) {
          for (const otherRoleId of groupRoles) {
            if (otherRoleId !== roleId && member.roles.cache.has(otherRoleId)) {
              await member.roles.remove(otherRoleId).catch(() => {});
            }
          }
        }
      }
    }

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

  const buttons = menus.map((m, i) =>
    new ButtonBuilder().setCustomId(`rr:edit:${m.id}`).setLabel(`✏️ Edit ${i + 1}`).setStyle(ButtonStyle.Primary)
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rr:create").setLabel("➕ Create New").setStyle(ButtonStyle.Success),
    ...buttons.slice(0, 4), // max 5 buttons per row; adjust as needed
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

    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  const msg = await interaction.channel.send({ embeds: [embed], components });
  db.saveMessageId(menuId, interaction.channel.id, msg.id);
  await interaction.update({ content: "🚀 Published!", components: [] });
}

client.login(process.env.TOKEN);
