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
      dropdownRoles: [], // just array of role IDs for dropdowns
      buttonRoles: [],   // array of { roleId, emoji } for buttons
      selectionType: [],
      exclusions: {},    // object for exclusions, e.g. { region: [roleId1, roleId2] }
      limits: {},        // e.g. { maxRoles: number }
      channelId: null,
      messageId: null,
    });
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map(id => ({ id, ...this.menuData.get(id) }));
  },
  saveRoles(menuId, roles, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    if (type === "dropdown") {
      // dropdownRoles are stored as array of role IDs (strings)
      menu.dropdownRoles = roles;
    }
    if (type === "button") {
      // buttonRoles will be temporarily stored as array of role IDs until emojis added
      // so store as array of objects with roleId and null emoji
      menu.buttonRoles = roles.map(roleId => ({ roleId, emoji: null }));
    }
  },
  saveButtonRoleEmoji(menuId, roleId, emoji) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    const roleEntry = menu.buttonRoles.find(r => r.roleId === roleId);
    if (roleEntry) {
      roleEntry.emoji = emoji;
    }
  },
  saveSelectionType(menuId, types) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.selectionType = types;
  },
  saveExclusions(menuId, exclusions) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.exclusions = exclusions;
  },
  saveLimits(menuId, limits) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.limits = limits;
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
    // Slash command: /dashboard
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard")
      return sendMainDashboard(interaction);

    // Button interactions
    if (interaction.isButton()) {
      const [ctx, action, extra, menuId, ...rest] = interaction.customId.split(":");

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
                  .setMaxLength(200)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "publish") return publishMenu(interaction, extra);

        if (action === "type") {
          let selectedTypes =
            extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(menuId, selectedTypes);

          // Start with dropdown if included, else buttons
          const nextType = selectedTypes.includes("dropdown") ? "dropdown" : "button";

          const allRoles = interaction.guild.roles.cache.filter(
            (r) => !r.managed && r.id !== interaction.guild.id
          );

          // Show select menu to pick roles for the nextType
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

        // Button to add emoji for a button role
        if (action === "addemoji") {
          // extra = menuId, rest[0] = roleId
          const roleId = rest[0];
          const menu = db.getMenu(extra);
          if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

          const role = interaction.guild.roles.cache.get(roleId);
          if (!role) return interaction.reply({ content: "❌ Role not found.", flags: 64 });

          // Show modal to input emoji for this role
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:addemoji:${extra}:${roleId}`)
            .setTitle(`Add Emoji for ${role.name}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("emoji")
                  .setLabel("Emoji (unicode or custom)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
              )
            );
          return interaction.showModal(modal);
        }
      }

      // Button role assign/unassign when user clicks a button on published message
      if (ctx === "rr" && action === "assign") {
        const roleId = extra;
        const member = interaction.member;

        // Implement exclusions and limits here if needed (optional)
        // For example, you could remove excluded roles when adding one

        const hasRole = member.roles.cache.has(roleId);
        if (hasRole) await member.roles.remove(roleId);
        else await member.roles.add(roleId);

        return interaction.reply({
          content: `✅ You have ${hasRole ? "removed" : "added"} <@&${roleId}>`,
          flags: 64,
        });
      }
    }

    // Modal submits
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
          flags: 64,
        });
      }

      // Modal to add emoji for button role
      if (interaction.customId.startsWith("rr:modal:addemoji:")) {
        const [, , , menuId, roleId] = interaction.customId.split(":");
        const emojiInput = interaction.fields.getTextInputValue("emoji").trim();
        if (!emojiInput) {
          return interaction.reply({
            content: "❌ No emoji entered, keeping it empty.",
            flags: 64,
          });
        }

        // Save emoji to buttonRoles for that roleId
        db.saveButtonRoleEmoji(menuId, roleId, emojiInput);

        return interaction.reply({
          content: `✅ Emoji "${emojiInput}" saved for role.`,
          flags: 64,
        });
      }
    }

    // Role selection in dropdown
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:selectroles:")) {
      const [_, __, type, menuId] = interaction.customId.split(":");
      if (!interaction.values.length)
        return interaction.reply({ content: "❌ No roles selected.", flags: 64 });

      db.saveRoles(menuId, interaction.values, type);

      const selectionType = db.getMenu(menuId).selectionType;

      // If button roles were just saved, we must prompt to add emojis to each button role!
      if (type === "button") {
        // Prompt for emojis for each button role one by one:
        const menu = db.getMenu(menuId);
        const rolesNeedingEmoji = menu.buttonRoles.filter((r) => !r.emoji);

        if (rolesNeedingEmoji.length) {
          const nextRole = rolesNeedingEmoji[0];
          // Show buttons to add emoji or skip emoji
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`rr:addemoji:${menuId}:${nextRole.roleId}`)
              .setLabel(`Add Emoji for <@&${nextRole.roleId}>`)
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`rr:skipemoji:${menuId}:${nextRole.roleId}`)
              .setLabel(`Skip Emoji for <@&${nextRole.roleId}>`)
              .setStyle(ButtonStyle.Secondary)
          );
          return interaction.update({
            content: `✅ Saved button roles. You can add emojis for buttons now or skip.`,
            components: [row],
          });
        }
      }

      // Check if still need roles for other selection types
      const stillNeeds = selectionType.includes("dropdown") && !db.getMenu(menuId).dropdownRoles.length
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
          .setMaxValues(Math.min(allRoles.size, 25))
          .addOptions(
            allRoles.map((r) => ({
              label: r.name,
              value: r.id,
            }))
          );

        return interaction.update({
          content: `✅ Saved roles for ${type}. Now select roles for **${stillNeeds}**:`,
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }

      // All roles saved, prompt publish
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
      return interaction.update({ content: "✅ All roles saved. Click Publish to post.", components: [row] });
    }

    // Emoji skip button - user skips emoji for a role
    if (interaction.isButton() && interaction.customId.startsWith("rr:skipemoji:")) {
      const [, , menuId, roleId] = interaction.customId.split(":");
      db.saveButtonRoleEmoji(menuId, roleId, null); // explicitly no emoji

      // Check for next role needing emoji
      const menu = db.getMenu(menuId);
      const rolesNeedingEmoji = menu.buttonRoles.filter((r) => !r.emoji);

      if (rolesNeedingEmoji.length) {
        const nextRole = rolesNeedingEmoji[0];
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rr:addemoji:${menuId}:${nextRole.roleId}`)
            .setLabel(`Add Emoji for <@&${nextRole.roleId}>`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`rr:skipemoji:${menuId}:${nextRole.roleId}`)
            .setLabel(`Skip Emoji for <@&${nextRole.roleId}>`)
            .setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({
          content: `✅ Skipped emoji for previous role. Add emoji or skip for next role:`,
          components: [row],
        });
      }

      // No more emoji prompts — show publish buttons
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
        content: "✅ All button roles updated. Click Publish to post.",
        components: [row],
      });
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: `❌ Error: ${error.message}`, flags: 64 }).catch(() => {});
    } else {
      interaction.reply({ content: `❌ Error: ${error.message}`, flags: 64 }).catch(() => {});
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
  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
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
  if (!menu) return interaction.reply({ content: "❌ Menu not found.", flags: 64 });

  const embed = new EmbedBuilder().setTitle(menu.name).setDescription(menu.desc);
  const components = [];

  // Dropdown roles
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const dropdown = new StringSelectMenuBuilder()
      .setCustomId(`rr:use:${menuId}`)
      .setMinValues(0)
      .setMaxValues(menu.dropdownRoles.length)
      .addOptions(
        menu.dropdownRoles.map((roleId) => {
          const role = interaction.guild.roles.cache.get(roleId);
          return {
            label: role?.name || "Unknown",
            value: roleId,
          };
        })
      );
    components.push(new ActionRowBuilder().addComponents(dropdown));
  }

  // Button roles
  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const buttons = menu.buttonRoles.map(({ roleId, emoji }) => {
      const role = interaction.guild.roles.cache.get(roleId);
      const btn = new ButtonBuilder()
        .setCustomId(`rr:assign:${roleId}`)
        .setLabel(role?.name || "Unknown")
        .setStyle(ButtonStyle.Secondary);
      if (emoji) {
        try {
          btn.setEmoji(emoji);
        } catch {
          // Invalid emoji - ignore silently
        }
      }
      return btn;
    });

    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  // Send or edit the message in stored channel/message or current channel
  try {
    if (menu.channelId && menu.messageId) {
      const channel = await client.channels.fetch(menu.channelId).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(menu.messageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [embed], components });
          return interaction.reply({ content: "✅ Menu updated.", flags: 64 });
        }
      }
    }

    // Otherwise send new message and save channel/message IDs
    const sentMsg = await interaction.channel.send({ embeds: [embed], components });
    db.saveMessageId(menuId, interaction.channel.id, sentMsg.id);
    return interaction.reply({ content: "✅ Menu published!", flags: 64 });
  } catch (err) {
    console.error(err);
    return interaction.reply({ content: "❌ Failed to publish menu.", flags: 64 });
  }
}

client.login(process.env.TOKEN);
