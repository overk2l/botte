// index.js (Updated with emoji validation and menu ID checks)
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
      dropdownEmojis: {}, // roleId -> emoji string
      buttonEmojis: {}, // roleId -> emoji string
      selectionType: [],
      roleLimits: {}, // roleId -> limit count
      exclusions: {},  // exclusion group -> array of roleIds
      channelId: null,
      messageId: null,
    });
    console.log(`Menu created with ID: ${id} for guild: ${guildId}`);
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map(id => ({ id, ...this.menuData.get(id) }));
  },
  saveRoles(menuId, roles, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return false;
    if (type === "dropdown") menu.dropdownRoles = roles;
    if (type === "button") menu.buttonRoles = roles;
    return true;
  },
  saveEmojis(menuId, emojis, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return false;
    if (type === "dropdown") menu.dropdownEmojis = emojis;
    if (type === "button") menu.buttonEmojis = emojis;
    return true;
  },
  saveSelectionType(menuId, types) {
    const menu = this.menuData.get(menuId);
    if (!menu) return false;
    menu.selectionType = types;
    return true;
  },
  saveRoleLimits(menuId, limits) {
    const menu = this.menuData.get(menuId);
    if (!menu) return false;
    menu.roleLimits = limits;
    return true;
  },
  saveExclusions(menuId, exclusions) {
    const menu = this.menuData.get(menuId);
    if (!menu) return false;
    menu.exclusions = exclusions;
    return true;
  },
  getMenu(menuId) {
    return this.menuData.get(menuId);
  },
  saveMessageId(menuId, channelId, messageId) {
    const menu = this.menuData.get(menuId);
    if (!menu) return false;
    menu.channelId = channelId;
    menu.messageId = messageId;
    return true;
  },
};

// Utility to parse emoji string into Discord emoji object if possible
function parseEmojiString(emojiStr) {
  if (!emojiStr) return null;

  // If unicode emoji (like '🔥'), just return string
  if (/^[\p{Emoji}\u200d]+$/u.test(emojiStr)) return emojiStr;

  // Custom emoji format: <a:name:id> or <name:id>
  const match = emojiStr.match(/^<a?:([^:]+):(\d+)>$/);
  if (match) {
    return { id: match[2], name: match[1], animated: emojiStr.startsWith("<a:") };
  }

  return null;
}

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
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
      return sendMainDashboard(interaction);
    }

    if (interaction.isButton()) {
      const parts = interaction.customId.split(":");
      if (parts.length < 2) {
        return interaction.reply({ content: "Invalid button interaction.", ephemeral: true });
      }
      const [ctx, action, extra, menuId, ...rest] = parts;

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
                  .setPlaceholder("Give your menu a name")
                  .setRequired(true)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("desc")
                  .setLabel("Embed Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setMaxLength(1000)
                  .setPlaceholder("Description shown in the embed")
                  .setRequired(true)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "publish") {
          if (!menuId) return interaction.reply({ content: "Menu ID missing for publish.", ephemeral: true });
          return publishMenu(interaction, menuId);
        }

        if (action === "type") {
          if (!menuId) return interaction.reply({ content: "Menu ID missing for selection type.", ephemeral: true });
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(menuId, selectedTypes);

          // Start with dropdown if included, else button
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

        // Button for adding emojis (modal trigger) for dropdown or buttons
        if (action === "addemoji") {
          if (!menuId || !extra) return interaction.reply({ content: "Missing menu or type for emoji input.", ephemeral: true });
          // Show modal to add emojis for the selected role type
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          // Prepare current roles for that type
          const roles = extra === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
          if (!roles.length) return interaction.reply({ content: `No roles selected for ${extra} yet.`, ephemeral: true });

          // Modal inputs for each role to enter emojis (optional)
          const modal = new ModalBuilder().setCustomId(`rr:modal:addemoji:${extra}:${menuId}`).setTitle(`Add Emojis to ${extra} roles`);
          const inputs = [];
          for (const roleId of roles) {
            const role = interaction.guild.roles.cache.get(roleId);
            inputs.push(
              new TextInputBuilder()
                .setCustomId(roleId)
                .setLabel(`Emoji for ${role ? role.name : "Unknown Role"}`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("Emoji or leave blank")
                .setRequired(false)
            );
          }
          // Add each input in its own ActionRow (Discord limitation)
          inputs.forEach((input) => modal.addComponents(new ActionRowBuilder().addComponents(input)));

          return interaction.showModal(modal);
        }
      }

      if (ctx === "rrbtn" && action === "toggle") {
        // Button role toggle handler
        if (!menuId || !extra) return interaction.reply({ content: "Menu or role ID missing.", ephemeral: true });
        const roleId = extra;
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const member = interaction.member;
        const hasRole = member.roles.cache.has(roleId);
        if (hasRole) await member.roles.remove(roleId);
        else {
          // Handle exclusions and limits here before adding role
          // (Implementation can be expanded)
          await member.roles.add(roleId);
        }
        return interaction.reply({ content: `✅ You now ${hasRole ? "removed" : "added"} <@&${roleId}>`, ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");
      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "create") {
        // Create new menu
        const name = interaction.fields.getTextInputValue("name");
        const desc = interaction.fields.getTextInputValue("desc");
        const menuId = db.createMenu(interaction.guild.id, name, desc);
        if (!menuId) return interaction.reply({ content: "Failed to create menu.", ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:type:dropdown:${menuId}`).setLabel("Use Dropdown").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:button:${menuId}`).setLabel("Use Buttons").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:both:${menuId}`).setLabel("Use Both").setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ content: "Choose how users should select roles:", components: [row], ephemeral: true });
      }

      if (parts[0] === "rr" && parts[1] === "modal" && parts[2] === "addemoji") {
        // Save emojis from modal for dropdown or buttons
        const type = parts[3]; // dropdown or button
        const menuId = parts[4];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        // Collect emojis from inputs
        const emojis = {};
        for (const [key, value] of interaction.fields.fields) {
          if (value.trim()) emojis[key] = value.trim();
        }
        db.saveEmojis(menuId, emojis, type);

        return interaction.reply({ content: `✅ Emojis saved for ${type}.`, ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu()) {
      const parts = interaction.customId.split(":");

      if (parts[0] === "rr" && parts[1] === "selectroles") {
        // Selecting roles for dropdown or button during creation
        const type = parts[2]; // dropdown or button
        const menuId = parts[3];
        if (!menuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });

        if (!interaction.values.length) return interaction.reply({ content: "❌ No roles selected.", ephemeral: true });
        db.saveRoles(menuId, interaction.values, type);

        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        // If multiple types, prompt for the other next
        const selectionType = menu.selectionType;
        let stillNeeds = null;
        if (selectionType.includes("dropdown") && !menu.dropdownRoles.length) stillNeeds = "dropdown";
        else if (selectionType.includes("button") && !menu.buttonRoles.length) stillNeeds = "button";

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

        // After roles selected, offer to add emojis or publish
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:addemoji:dropdown:${menuId}`).setLabel("Add Emojis (Dropdown)").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:addemoji:button:${menuId}`).setLabel("Add Emojis (Buttons)").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({ content: "✅ All roles saved. Add emojis or publish:", components: [row] });
      }

      if (parts[0] === "rr" && parts[1] === "use") {
        // User selecting roles from dropdown in published menu
        const menuId = parts[2];
        if (!menuId) return interaction.reply({ content: "Menu ID missing.", ephemeral: true });
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        const chosen = interaction.values;
        const member = interaction.member;

        // Handle role limits and exclusions here if implemented (expand as needed)

        // Add selected roles, remove unselected
        for (const roleId of menu.dropdownRoles) {
          if (chosen.includes(roleId)) {
            if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
          } else {
            if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
          }
        }
        return interaction.reply({ content: "✅ Your roles have been updated!", ephemeral: true });
      }
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
      } catch {}
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
    ...menus.map((m, i) =>
      new ButtonBuilder().setCustomId(`rr:edit:${m.id}`).setLabel(`✏️ Edit ${i + 1}`).setStyle(ButtonStyle.Primary)
    ),
    new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({ embeds: [embed], components: [row] });
}

async function publishMenu(interaction, menuId) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

  const embed = new EmbedBuilder().setTitle(menu.name).setDescription(menu.desc);

  const components = [];

  // Dropdown with emojis if available
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const options = menu.dropdownRoles.map((roleId) => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return null;

      let emojiStr = menu.dropdownEmojis[roleId];
      let emoji = null;
      if (emojiStr) {
        emoji = parseEmojiString(emojiStr);
      }

      return {
        label: role.name,
        value: roleId,
        emoji: emoji || undefined,
      };
    }).filter(Boolean);

    const dropdown = new StringSelectMenuBuilder()
      .setCustomId(`rr:use:${menuId}`)
      .setMinValues(0)
      .setMaxValues(options.length)
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(dropdown));
  }

  // Buttons with emojis if available
  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const buttons = menu.buttonRoles.map((roleId) => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return null;

      let emojiStr = menu.buttonEmojis[roleId];
      let button = new ButtonBuilder()
        .setCustomId(`rrbtn:toggle:${menuId}:${roleId}`)
        .setLabel(role.name)
        .setStyle(ButtonStyle.Secondary);

      if (emojiStr) {
        const parsedEmoji = parseEmojiString(emojiStr);
        if (parsedEmoji) button.setEmoji(parsedEmoji);
      }

      return button;
    }).filter(Boolean);

    // Discord allows max 5 buttons per row, so split if needed
    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  // Send or update message
  let msg;
  if (menu.channelId && menu.messageId) {
    try {
      const channel = await client.channels.fetch(menu.channelId);
      msg = await channel.messages.fetch(menu.messageId);
      await msg.edit({ embeds: [embed], components });
    } catch {
      // If failed to fetch message, send new and save
      const channel = await interaction.channel.fetch();
      msg = await channel.send({ embeds: [embed], components });
      db.saveMessageId(menuId, msg.channel.id, msg.id);
    }
  } else {
    const channel = await interaction.channel.fetch();
    msg = await channel.send({ embeds: [embed], components });
    db.saveMessageId(menuId, msg.channel.id, msg.id);
  }

  await interaction.reply({ content: "🚀 Menu published successfully!", ephemeral: true });
}

client.login(process.env.TOKEN);
