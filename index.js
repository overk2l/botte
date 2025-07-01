// index.js (Full updated version with dropdown & button support)
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
    this.menuData.set(id, { guildId, name, desc, roles: [], selectionType: [], channelId: null, messageId: null });
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map(id => ({ id, ...this.menuData.get(id) }));
  },
  saveMenuRoles(menuId, roles) {
    this.menuData.get(menuId).roles = roles;
  },
  saveSelectionType(menuId, types) {
    this.menuData.get(menuId).selectionType = types; // ['dropdown', 'button']
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

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST().setToken(process.env.TOKEN);
  const cmd = new SlashCommandBuilder().setName("dashboard").setDescription("Open the guild dashboard").toJSON();
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
  console.log("📑 /dashboard command deployed");
});

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") return sendMainDashboard(interaction);

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

      if (action === "publish") return publishMenu(interaction, menuId);
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === "rr:modal:create") {
    const name = interaction.fields.getTextInputValue("name");
    const desc = interaction.fields.getTextInputValue("desc");
    const menuId = db.createMenu(interaction.guild.id, name, desc);

    const roles = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id).map(r => ({ label: r.name, value: r.id }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rr:select:${menuId}`)
      .setMinValues(1)
      .setMaxValues(roles.length)
      .addOptions(roles.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({ content: "Select roles to include:", components: [row], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:select:")) {
    const menuId = interaction.customId.split(":")[2];
    db.saveMenuRoles(menuId, interaction.values);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rr:type:dropdown:${menuId}`).setLabel("Use Dropdown").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rr:type:button:${menuId}`).setLabel("Use Buttons").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rr:type:both:${menuId}`).setLabel("Use Both").setStyle(ButtonStyle.Success)
    );

    await interaction.update({ content: "✅ Roles saved. Choose how users should select:", components: [row] });
  }

  if (interaction.isButton() && interaction.customId.startsWith("rr:type:")) {
    const [_, __, type, menuId] = interaction.customId.split(":");
    let selectedTypes = [];
    if (type === "both") selectedTypes = ["dropdown", "button"];
    else selectedTypes = [type];

    db.saveSelectionType(menuId, selectedTypes);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
    );

    return interaction.update({ content: "✅ Selection type saved! Click Publish to post it.", components: [row] });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:use:")) {
    const menuId = interaction.customId.split(":")[2];
    const menu = db.getMenu(menuId);
    const chosen = interaction.values;
    const member = interaction.member;

    for (const roleId of menu.roles) {
      if (chosen.includes(roleId)) {
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
      } else {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
      }
    }
    return interaction.reply({ content: "✅ Your roles have been updated!", flags: 64 });
  }

  if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
    const roleId = interaction.customId.split(":")[2];
    const member = interaction.member;
    const hasRole = member.roles.cache.has(roleId);

    if (hasRole) await member.roles.remove(roleId);
    else await member.roles.add(roleId);

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

  if (menu.selectionType.includes("dropdown")) {
    const dropdown = new StringSelectMenuBuilder()
      .setCustomId(`rr:use:${menuId}`)
      .setMinValues(0)
      .setMaxValues(menu.roles.length)
      .addOptions(menu.roles.map(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        return { label: role?.name || "Unknown", value: roleId };
      }));
    components.push(new ActionRowBuilder().addComponents(dropdown));
  }

  if (menu.selectionType.includes("button")) {
    const buttons = menu.roles.map(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      return new ButtonBuilder()
        .setCustomId(`rr:assign:${roleId}`)
        .setLabel(role?.name || "Unknown")
        .setStyle(ButtonStyle.Secondary);
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
