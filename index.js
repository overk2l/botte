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
    this.menus.has(guildId) || this.menus.set(guildId, []);
    this.menus.get(guildId).push(id);
    this.menuData.set(id, {
      guildId,
      name,
      desc,
      dropdownRoles: [],
      buttonRoles: [],
      selectionType: [],
      emojis: { dropdown: {}, button: {} },
      limits: { dropdown: 0, button: 0 },
      exclusions: {},
      channelId: null,
      messageId: null,
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
  saveEmojis(menuId, emojis, type) {
    this.menuData.get(menuId).emojis[type] = emojis;
  },
  saveLimits(menuId, limits) {
    Object.assign(this.menuData.get(menuId).limits, limits);
  },
  saveExclusions(menuId, exclusions) {
    this.menuData.get(menuId).exclusions = exclusions;
  },
  getMenu(menuId) {
    return this.menuData.get(menuId);
  },
  saveMessageId(menuId, channelId, messageId) {
    const m = this.menuData.get(menuId);
    m.channelId = channelId;
    m.messageId = messageId;
  },
};

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST().setToken(process.env.TOKEN);
  const cmd = new SlashCommandBuilder().setName("dashboard").setDescription("Open the guild dashboard").toJSON();
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
  console.log("📑 /dashboard command deployed");
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") return sendMainDashboard(interaction);

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
                new TextInputBuilder().setCustomId("name").setLabel("Menu Name").setStyle(TextInputStyle.Short).setMaxLength(45)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("desc").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "publish") return publishMenu(interaction, extra);

        if (action === "type") {
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(menuId, selectedTypes);

          // Start role selection with dropdown first if exists, else buttons
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
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "rr:modal:create") {
        const name = interaction.fields.getTextInputValue("name");
        const desc = interaction.fields.getTextInputValue("desc");
        const menuId = db.createMenu(interaction.guild.id, name, desc);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:type:dropdown:${menuId}`).setLabel("Use Dropdown").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:button:${menuId}`).setLabel("Use Buttons").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:both:${menuId}`).setLabel("Use Both").setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ content: "Choose how users should select roles:", components: [row], ephemeral: true });
      }

      // Emoji modal submission for dropdown or buttons
      if (interaction.customId.startsWith("rr:modal:emoji:")) {
        const [, , type, menuId] = interaction.customId.split(":");
        const emojiInput = interaction.fields.getTextInputValue("emojiInput").trim();

        // Parse emojis from input (expected JSON or comma separated)
        let emojis = {};
        try {
          emojis = JSON.parse(emojiInput);
          if (typeof emojis !== "object" || Array.isArray(emojis)) throw new Error("Invalid emoji JSON");
        } catch {
          // fallback: parse simple CSV roleId=emoji
          emojis = {};
          const pairs = emojiInput.split(",");
          for (const p of pairs) {
            const [roleId, emoji] = p.split("=").map((x) => x.trim());
            if (roleId && emoji) emojis[roleId] = emoji;
          }
        }

        db.saveEmojis(menuId, emojis, type);
        return interaction.reply({ content: `✅ Saved emojis for **${type}** roles!`, ephemeral: true });
      }

      // Limits modal submission
      if (interaction.customId === "rr:modal:limits") {
        const dropdownLimitRaw = interaction.fields.getTextInputValue("dropdownLimit");
        const buttonLimitRaw = interaction.fields.getTextInputValue("buttonLimit");

        const dropdownLimit = Number(dropdownLimitRaw) || 0;
        const buttonLimit = Number(buttonLimitRaw) || 0;

        db.saveLimits(interaction.customId.split(":")[2], { dropdown: dropdownLimit, button: buttonLimit });
        return interaction.reply({ content: `✅ Saved role selection limits!`, ephemeral: true });
      }

      // Exclusions modal submission
      if (interaction.customId === "rr:modal:exclusions") {
        const exclusionsRaw = interaction.fields.getTextInputValue("exclusionsInput");
        let exclusions = {};
        try {
          exclusions = JSON.parse(exclusionsRaw);
        } catch {
          return interaction.reply({ content: "❌ Invalid JSON for exclusions.", ephemeral: true });
        }
        db.saveExclusions(interaction.customId.split(":")[2], exclusions);
        return interaction.reply({ content: "✅ Saved exclusions!", ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:selectroles:")) {
      const [_, __, type, menuId] = interaction.customId.split(":");
      if (!interaction.values.length) return interaction.reply({ content: "❌ No roles selected.", ephemeral: true });

      db.saveRoles(menuId, interaction.values, type);
      const selectionType = db.getMenu(menuId).selectionType;
      const stillNeeds = selectionType.includes("dropdown") && !db.getMenu(menuId).dropdownRoles.length
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

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:use:")) {
      const menuId = interaction.customId.split(":")[2];
      const menu = db.getMenu(menuId);
      const chosen = interaction.values;
      const member = interaction.member;

      // Enforce limits
      const limits = menu.limits || { dropdown: 0, button: 0 };
      if (limits.dropdown && chosen.length > limits.dropdown) {
        return interaction.reply({
          content: `❌ You can only select up to ${limits.dropdown} roles in this dropdown.`,
          ephemeral: true,
        });
      }

      for (const roleId of menu.dropdownRoles) {
        if (chosen.includes(roleId)) {
          if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
        } else {
          if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
        }
      }
      return interaction.reply({ content: "✅ Your roles have been updated!", ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
      const roleId = interaction.customId.split(":")[2];
      const member = interaction.member;
      const hasRole = member.roles.cache.has(roleId);

      // Remove excluded roles if needed (simple example, extend your logic)
      // TODO: Implement exclusions effect here on assign

      if (hasRole) await member.roles.remove(roleId);
      else await member.roles.add(roleId);

      return interaction.reply({ content: `✅ You now ${hasRole ? "removed" : "added"} <@&${roleId}>`, ephemeral: true });
    }
  } catch (error) {
    console.error("Interaction error:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "❌ An error occurred.", ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: "❌ An error occurred.", ephemeral: true }).catch(() => {});
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
            emoji: emoji || undefined,
          };
        })
      );
    components.push(new ActionRowBuilder().addComponents(dropdown));
  }

  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const buttons = menu.buttonRoles.map((roleId) => {
      const role = interaction.guild.roles.cache.get(roleId);
      const emoji = menu.emojis.button?.[roleId];
      const button = new ButtonBuilder()
        .setCustomId(`rr:assign:${roleId}`)
        .setLabel(role?.name || "Unknown")
        .setStyle(ButtonStyle.Secondary);
      if (emoji) button.setEmoji(emoji); // only set if defined, fix crash here
      return button;
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
