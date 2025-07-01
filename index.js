// index.js (Updated: Dropdown + Button role separation + Optional Emojis + Exclusions + Limits)
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
      dropdownEmojis: [],
      buttonEmojis: [],
      selectionType: [],
      exclusions: {}, // JSON parsed object for exclusions
      limits: { dropdown: 25, button: 25 }, // default limits
      channelId: null,
      messageId: null,
    });
    return id;
  },

  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map((id) => ({
      id,
      ...this.menuData.get(id),
    }));
  },

  saveRoles(menuId, roles, type) {
    if (type === "dropdown") this.menuData.get(menuId).dropdownRoles = roles;
    if (type === "button") this.menuData.get(menuId).buttonRoles = roles;
  },

  saveEmojis(menuId, emojis, type) {
    if (type === "dropdown") this.menuData.get(menuId).dropdownEmojis = emojis;
    if (type === "button") this.menuData.get(menuId).buttonEmojis = emojis;
  },

  saveSelectionType(menuId, types) {
    this.menuData.get(menuId).selectionType = types;
  },

  saveExclusions(menuId, exclusionsObj) {
    this.menuData.get(menuId).exclusions = exclusionsObj;
  },

  saveLimits(menuId, limits) {
    this.menuData.get(menuId).limits = limits;
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
        return interaction.showModal(modal);
      }

      if (action === "publish") return publishMenu(interaction, extra);

      if (action === "type") {
        // Save selection types
        let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
        db.saveSelectionType(menuId, selectedTypes);

        // Next step: select roles for first type
        const nextType = selectedTypes[0];
        const allRoles = interaction.guild.roles.cache.filter(
          (r) => !r.managed && r.id !== interaction.guild.id
        );
        const select = new StringSelectMenuBuilder()
          .setCustomId(`rr:selectroles:${nextType}:${menuId}`)
          .setMinValues(1)
          .setMaxValues(
            Math.min(
              nextType === "dropdown"
                ? db.getMenu(menuId).limits.dropdown
                : db.getMenu(menuId).limits.button,
              allRoles.size,
              25
            )
          )
          .addOptions(
            allRoles.map((r) => ({ label: r.name, value: r.id })).slice(0, 25)
          );

        return interaction.update({
          content: `✅ Selection type saved. Now select roles for **${nextType}**:`,
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }

      if (action === "addemoji") {
        // Show modal to add emojis for dropdown or button roles
        const type = extra; // "dropdown" or "button"
        const menu = db.getMenu(menuId);

        const modal = new ModalBuilder()
          .setCustomId(`rr:modal:addemoji:${type}:${menuId}`)
          .setTitle(`Add emojis for ${type} roles (comma separated)`);

        // Prepare default text with existing emojis (if any)
        const existingEmojis =
          type === "dropdown" ? menu.dropdownEmojis : menu.buttonEmojis;
        const defaultValue = existingEmojis.length
          ? existingEmojis.join(", ")
          : "";

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("emojis")
              .setLabel(
                "Enter emojis corresponding to roles in the same order, comma separated"
              )
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder("e.g. 😀, 🔥, 🐱‍👤")
              .setValue(defaultValue)
          )
        );
        return interaction.showModal(modal);
      }

      if (action === "limits") {
        // Show modal for limits input
        const menu = db.getMenu(menuId);
        const modal = new ModalBuilder()
          .setCustomId(`rr:modal:limits:${menuId}`)
          .setTitle("Set role selection limits");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("dropdownLimit")
              .setLabel("Dropdown selection limit (max 25)")
              .setStyle(TextInputStyle.Short)
              .setValue(menu.limits.dropdown.toString())
              .setPlaceholder("Enter a number 1-25")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("buttonLimit")
              .setLabel("Button selection limit (max 25)")
              .setStyle(TextInputStyle.Short)
              .setValue(menu.limits.button.toString())
              .setPlaceholder("Enter a number 1-25")
          )
        );
        return interaction.showModal(modal);
      }

      if (action === "exclusions") {
        // Show modal for exclusions JSON
        const menu = db.getMenu(menuId);
        const modal = new ModalBuilder()
          .setCustomId(`rr:modal:exclusions:${menuId}`)
          .setTitle("Set role exclusions (JSON)");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("exclusionsJSON")
              .setLabel("Enter exclusions JSON. Example:\n{\"region\": [\"roleId1\", \"roleId2\"]}")
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('{"region": ["roleId1", "roleId2"]}')
              .setValue(JSON.stringify(menu.exclusions, null, 2))
              .setRequired(false)
          )
        );
        return interaction.showModal(modal);
      }
    }
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith("rr:modal:")
  ) {
    const parts = interaction.customId.split(":");
    const modalAction = parts[2];
    const menuId = parts[3];
    const menu = db.getMenu(menuId);
    if (!menu)
      return interaction.reply({
        content: "❌ Menu not found.",
        flags: 64,
      });

    if (modalAction === "create") {
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

      return interaction.reply({
        content: "Choose how users should select roles:",
        components: [row],
        flags: 64,
      });
    }

    if (modalAction === "addemoji") {
      const type = parts[3];
      const menuId2 = parts[4];
      const emojisRaw = interaction.fields.getTextInputValue("emojis");
      const emojis = emojisRaw
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
      db.saveEmojis(menuId2, emojis, type);

      return interaction.reply({
        content: `✅ Emojis saved for ${type} roles.`,
        flags: 64,
      });
    }

    if (modalAction === "limits") {
      const dropdownLimitRaw = interaction.fields.getTextInputValue("dropdownLimit");
      const buttonLimitRaw = interaction.fields.getTextInputValue("buttonLimit");
      let dropdownLimit = parseInt(dropdownLimitRaw);
      let buttonLimit = parseInt(buttonLimitRaw);
      if (isNaN(dropdownLimit) || dropdownLimit < 1 || dropdownLimit > 25)
        dropdownLimit = 25;
      if (isNaN(buttonLimit) || buttonLimit < 1 || buttonLimit > 25) buttonLimit = 25;
      db.saveLimits(menuId, { dropdown: dropdownLimit, button: buttonLimit });

      return interaction.reply({
        content: `✅ Limits updated. Dropdown: ${dropdownLimit}, Buttons: ${buttonLimit}`,
        flags: 64,
      });
    }

    if (modalAction === "exclusions") {
      const exclusionsRaw = interaction.fields.getTextInputValue("exclusionsJSON").trim();
      if (!exclusionsRaw) {
        db.saveExclusions(menuId, {});
        return interaction.reply({
          content: `✅ Exclusions cleared.`,
          flags: 64,
        });
      }
      try {
        const exclusionsObj = JSON.parse(exclusionsRaw);
        if (typeof exclusionsObj !== "object" || Array.isArray(exclusionsObj)) {
          throw new Error("Exclusions JSON must be an object");
        }
        db.saveExclusions(menuId, exclusionsObj);
        return interaction.reply({
          content: `✅ Exclusions saved.`,
          flags: 64,
        });
      } catch (e) {
        return interaction.reply({
          content: `❌ Invalid JSON: ${e.message}`,
          flags: 64,
        });
      }
    }
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("rr:selectroles:")
  ) {
    const [_, __, type, menuId] = interaction.customId.split(":");
    if (!interaction.values.length)
      return interaction.reply({ content: "❌ No roles selected.", flags: 64 });

    // Save roles respecting limits
    const menu = db.getMenu(menuId);
    const limit = type === "dropdown" ? menu.limits.dropdown : menu.limits.button;
    if (interaction.values.length > limit)
      return interaction.reply({
        content: `❌ You can select up to ${limit} roles for ${type}.`,
        flags: 64,
      });

    db.saveRoles(menuId, interaction.values, type);

    // Next step: check if need to select other roles based on selectionType
    const selectionType = db.getMenu(menuId).selectionType;
    const stillNeeds =
      selectionType.includes("dropdown") && !db.getMenu(menuId).dropdownRoles.length
        ? "dropdown"
        : selectionType.includes("button") && !db.getMenu(menuId).buttonRoles.length
        ? "button"
        : null;

    if (stillNeeds) {
      const allRoles = interaction.guild.roles.cache.filter(
        (r) => !r.managed && r.id !== interaction.guild.id
      );
      const select = new StringSelectMenuBuilder()
        .setCustomId(`rr:selectroles:${stillNeeds}:${menuId}`)
        .setMinValues(1)
        .setMaxValues(
          Math.min(
            stillNeeds === "dropdown"
              ? db.getMenu(menuId).limits.dropdown
              : db.getMenu(menuId).limits.button,
            allRoles.size,
            25
          )
        )
        .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })).slice(0, 25));

      return interaction.update({
        content: `✅ Saved roles for ${type}. Now select roles for **${stillNeeds}**:`,
        components: [new ActionRowBuilder().addComponents(select)],
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rr:addemoji:dropdown:${menuId}`)
        .setLabel("Add Emojis to Dropdown")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rr:addemoji:button:${menuId}`)
        .setLabel("Add Emojis to Buttons")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rr:limits:${menuId}`)
        .setLabel("Set Limits")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rr:exclusions:${menuId}`)
        .setLabel("Set Exclusions")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rr:publish:${menuId}`)
        .setLabel("🚀 Publish")
        .setStyle(ButtonStyle.Primary)
    );
    return interaction.update({
      content: "✅ All roles saved. Use the buttons below to add emojis, limits, exclusions or publish.",
      components: [row],
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:use:")) {
    const menuId = interaction.customId.split(":")[2];
    const menu = db.getMenu(menuId);
    if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

    const chosen = interaction.values;
    const member = interaction.member;

    // Apply exclusions before assigning roles:
    // Example exclusions format:
    // { "region": ["roleId1", "roleId2"] }
    // When a role from a group is selected, remove other roles from the same group.

    const exclusions = menu.exclusions || {};

    // Build a reverse map from roleId to group key
    const roleToGroup = {};
    for (const [group, roles] of Object.entries(exclusions)) {
      for (const rId of roles) roleToGroup[rId] = group;
    }

    // First remove conflicting roles per exclusion groups
    for (const group of Object.keys(exclusions)) {
      const rolesInGroup = exclusions[group];
      const chosenRolesInGroup = chosen.filter((r) => rolesInGroup.includes(r));
      if (chosenRolesInGroup.length > 0) {
        // Remove from member all other roles in this group not chosen
        for (const rId of rolesInGroup) {
          if (!chosenRolesInGroup.includes(rId) && member.roles.cache.has(rId)) {
            await member.roles.remove(rId).catch(() => {});
          }
        }
      }
    }

    // Now assign or remove roles for dropdown roles (allow multiple)
    for (const roleId of menu.dropdownRoles) {
      if (chosen.includes(roleId)) {
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId).catch(() => {});
      } else {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId).catch(() => {});
      }
    }

    return interaction.reply({
      content: "✅ Your roles have been updated!",
      flags: 64,
    });
  }

  if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
    const roleId = interaction.customId.split(":")[2];
    const member = interaction.member;
    const hasRole = member.roles.cache.has(roleId);
    const menu = [...db.menuData.values()].find(
      (m) => m.buttonRoles.includes(roleId)
    );
    if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

    // Handle exclusions for buttons similarly
    const exclusions = menu.exclusions || {};
    const roleToGroup = {};
    for (const [group, roles] of Object.entries(exclusions)) {
      for (const rId of roles) roleToGroup[rId] = group;
    }

    const roleGroup = roleToGroup[roleId];
    if (roleGroup) {
      // Remove other roles in this exclusion group before toggling this role
      const otherRolesInGroup = exclusions[roleGroup].filter((r) => r !== roleId);
      for (const rId of otherRolesInGroup) {
        if (member.roles.cache.has(rId)) {
          await member.roles.remove(rId).catch(() => {});
        }
      }
    }

    // Check button limit if adding role
    if (!hasRole) {
      const maxButton = menu.limits.button || 25;
      const currentButtonCount = menu.buttonRoles.filter((r) =>
        member.roles.cache.has(r)
      ).length;
      if (currentButtonCount >= maxButton) {
        return interaction.reply({
          content: `❌ You can only have up to ${maxButton} button roles.`,
          flags: 64,
        });
      }
    }

    if (hasRole) await member.roles.remove(roleId).catch(() => {});
    else await member.roles.add(roleId).catch(() => {});

    return interaction.reply({
      content: `✅ You now ${hasRole ? "removed" : "added"} <@&${roleId}>`,
      flags: 64,
    });
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
  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function showReactionRolesDashboard(interaction) {
  const menus = db.getMenus(interaction.guild.id);
  const embed = new EmbedBuilder()
    .setTitle("🎨 Reaction Roles")
    .setDescription(
      menus.length ? menus.map((m, i) => `**${i + 1}.** ${m.name}`).join("\n") : "*No menus yet*"
    );
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
  if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

  const embed = new EmbedBuilder().setTitle(menu.name).setDescription(menu.desc);
  const components = [];

  // Dropdown with emojis optional
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const dropdown = new StringSelectMenuBuilder()
      .setCustomId(`rr:use:${menuId}`)
      .setMinValues(0)
      .setMaxValues(menu.limits.dropdown)
      .addOptions(
        menu.dropdownRoles.map((roleId, i) => {
          const role = interaction.guild.roles.cache.get(roleId);
          const emoji = menu.dropdownEmojis[i];
          return {
            label: role?.name || "Unknown",
            value: roleId,
            emoji: emoji || undefined,
          };
        })
      );
    components.push(new ActionRowBuilder().addComponents(dropdown));
  }

  // Buttons with emojis optional
  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const buttons = menu.buttonRoles.map((roleId, i) => {
      const role = interaction.guild.roles.cache.get(roleId);
      const emojiRaw = menu.buttonEmojis[i];
      let emojiObj = undefined;

      // Parse emoji if custom emoji ID or Unicode
      if (emojiRaw) {
        // If custom emoji format <:name:id>
        const customEmojiMatch = emojiRaw.match(/^<a?:\w+:(\d+)>$/);
        if (customEmojiMatch) {
          emojiObj = { id: customEmojiMatch[1], name: undefined };
        } else {
          // Unicode emoji
          emojiObj = emojiRaw;
        }
      }

      return new ButtonBuilder()
        .setCustomId(`rr:assign:${roleId}`)
        .setLabel(role?.name || "Unknown")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojiObj);
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
