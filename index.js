// index.js
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

// Simple in-memory store for demo purposes.
// Replace with your DB calls (e.g. Mongo, Postgres) in production.
const db = {
  menus: new Map(),          // guildId → [ menuId, … ]
  menuData: new Map(),       // menuId → { guildId, name, desc, roles: [], channelId?, messageId? }
  createMenu(guildId, name, desc) {
    const id = Date.now().toString();
    this.menus.has(guildId) || this.menus.set(guildId, []);
    this.menus.get(guildId).push(id);
    this.menuData.set(id, { guildId, name, desc, roles: [] });
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map(id => ({ id, ...this.menuData.get(id) }));
  },
  saveMenuRoles(menuId, roles) {
    this.menuData.get(menuId).roles = roles;
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
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Deploy /dashboard command on startup:
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

client.on("interactionCreate", async interaction => {
  // 1) Slash command handler
  if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
    return sendMainDashboard(interaction);
  }

  // 2) Button handler
  if (interaction.isButton()) {
    const [ctx, action, menuId] = interaction.customId.split(":");
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
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("desc")
          .setLabel("Embed Description")
          .setStyle(TextInputStyle.Paragraph)
      )
    );
  return interaction.showModal(modal);
      }

    }
  }

  // 3) Modal submit handler
  if (interaction.isModalSubmit() && interaction.customId === "rr:modal:create") {
    const name = interaction.fields.getTextInputValue("name");
    const desc = interaction.fields.getTextInputValue("desc");
    const menuId = db.createMenu(interaction.guild.id, name, desc);

    // Build a SelectMenu of roles (first 25)
    const roles = interaction.guild.roles.cache
      .filter(r => !r.managed && r.id !== interaction.guild.id)
      .map(r => ({ label: r.name, value: r.id }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rr:select:${menuId}`)
      .setMinValues(1)
      .setMaxValues(roles.length)
      .addOptions(roles.slice(0, 25));
    const row = new ActionRowBuilder().addComponents(select);

    return interaction.reply({
      content: "Select roles to include:",
      components: [row],
      ephemeral: true
    });
  }

  // 4) Select menu handler
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:select:")) {
    const menuId = interaction.customId.split(":")[2];
    const roleIds = interaction.values;
    db.saveMenuRoles(menuId, roleIds);
    // Offer Publish button
    const publishBtn = new ButtonBuilder()
      .setCustomId(`rr:publish:${menuId}`)
      .setLabel("🚀 Publish")
      .setStyle(ButtonStyle.Primary);
    const backBtn = new ButtonBuilder()
      .setCustomId("dash:back")
      .setLabel("🔙 Back")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(publishBtn, backBtn);

    return interaction.update({
      content: "✅ Menu created! Click Publish to post it in this channel.",
      components: [row],
    });
  }
});

// ---- Helper Functions ----

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
    .setDescription(
      menus.length
        ? menus.map((m, i) => `**${i + 1}.** ${m.name}`).join("\n")
        : "*No menus yet*"
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
  if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

  // Build public SelectMenu
  const select = new StringSelectMenuBuilder()
    .setCustomId(`rr:use:${menuId}`)
    .setMinValues(0)
    .setMaxValues(menu.roles.length)
    .addOptions(
      menu.roles.map(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        return { label: role.name, value: roleId };
      })
    );

  const embed = new EmbedBuilder().setTitle(menu.name).setDescription(menu.desc);
  const row = new ActionRowBuilder().addComponents(select);

  // Send or edit the message in the same channel
  const channel = interaction.channel;
  const msg = await channel.send({ embeds: [embed], components: [row] });
  db.saveMessageId(menuId, channel.id, msg.id);

  await interaction.update({
    content: "🚀 Published!",
    components: []
  });
}

// Finally, handle actual role toggling on public select menus:
client.on("interactionCreate", async interaction => {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:use:")) {
    const menuId = interaction.customId.split(":")[2];
    const menu = db.getMenu(menuId);
    const chosen = interaction.values;            // roles user selected
    const member = interaction.member;

    // Toggle each role
    for (const roleId of menu.roles) {
      if (chosen.includes(roleId)) {
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
      } else {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
      }
    }
    return interaction.reply({ content: "Your roles have been updated!", ephemeral: true });
  }
});

client.login(process.env.TOKEN);
