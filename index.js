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

// In-memory DB
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
      selectionType: [],
      dropdownRoles: [],
      buttonRoles: [],
      dropdownEmojis: {},
      buttonEmojis: {},
      roleLimits: { max: 0 },
      exclusions: {},
      channelId: null,
      messageId: null,
    });
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map(id => ({ id, ...this.menuData.get(id) }));
  },
  getMenu(menuId) {
    return this.menuData.get(menuId);
  },
  saveSelectionType(menuId, types) {
    const m = this.menuData.get(menuId);
    if (m) m.selectionType = types;
  },
  saveRoles(menuId, roles, type) {
    const m = this.menuData.get(menuId);
    if (!m) return;
    if (type === "dropdown") m.dropdownRoles = roles;
    else m.buttonRoles = roles;
  },
  saveEmojis(menuId, emojis, type) {
    const m = this.menuData.get(menuId);
    if (!m) return;
    if (type === "dropdown") m.dropdownEmojis = { ...m.dropdownEmojis, ...emojis };
    else m.buttonEmojis = { ...m.buttonEmojis, ...emojis };
  },
  saveLimits(menuId, max) {
    const m = this.menuData.get(menuId);
    if (m) m.roleLimits.max = max;
  },
  saveExclusions(menuId, exclusions) {
    const m = this.menuData.get(menuId);
    if (m) m.exclusions = exclusions;
  },
  saveMessageId(menuId, channelId, messageId) {
    const m = this.menuData.get(menuId);
    if (m) {
      m.channelId = channelId;
      m.messageId = messageId;
    }
  },
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST().setToken(process.env.TOKEN);
  const dashboard = new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Open the guild dashboard")
    .toJSON();

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [dashboard] }
  );

  console.log("📑 /dashboard deployed");
});

function parseEmoji(e) {
  if (!e) return undefined;
  const custom = e.match(/^<a?:([^:]+):(\d+)>$/);
  if (custom) return { id: custom[2], name: custom[1], animated: e.startsWith("<a:") };
  return { name: e };
}

function safeJSON(str, fallback = null) {
  try { return JSON.parse(str); } catch { return fallback; }
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("dash:reactionroles").setLabel("Reaction Roles").setStyle(ButtonStyle.Primary)
      );
      return interaction.reply({ content: "Dashboard", components: [row], ephemeral: true });
    }

    if (interaction.isButton()) {
      const [ctx, action, type, menuId] = interaction.customId.split(":");

      if (ctx === "dash") {
        if (action === "reactionroles") return showMenus(interaction);
        if (action === "back")          return interaction.update({ content: "Dashboard", components: [], ephemeral: true });
      }

      if (ctx === "rr") {
        switch (action) {
          case "create": {
            const modal = new ModalBuilder()
              .setCustomId("rrmodal:create")
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

          case "type": {
            db.saveSelectionType(menuId, type === "both" ? ["dropdown","button"] : [type]);
            const next = type === "both" || type === "dropdown" ? "dropdown" : "button";
            const all = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);
            const select = new StringSelectMenuBuilder()
              .setCustomId(`rrselectroles:${next}:${menuId}`)
              .setMinValues(1)
              .setMaxValues(Math.min(all.size,25))
              .addOptions(all.map(r=>({ label:r.name,value:r.id })));
            return interaction.update({ content: `Select ${next} roles:`, components: [new ActionRowBuilder().addComponents(select)] });
          }

          case "publish":
            return publishMenu(interaction, menuId);

          case "addemojis": {
            const menu = db.getMenu(menuId);
            const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
            const modal = new ModalBuilder().setCustomId(`rrmodal:addemojis:${type}:${menuId}`).setTitle(`Add Emojis for ${type}`);
            roles.slice(0,5).forEach(rid => {
              const role = interaction.guild.roles.cache.get(rid);
              modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(rid)
                  .setLabel(`Emoji for ${role?role.name:rid}`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
              ));
            });
            return interaction.showModal(modal);
          }

          case "setlimits": {
            const modal = new ModalBuilder()
              .setCustomId(`rrmodal:setlimits:${menuId}`)
              .setTitle("Set Max Roles (0 = no limit)")
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("max")
                    .setLabel("Max Roles")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                )
              );
            return interaction.showModal(modal);
          }

          case "setexclusions": {
            const modal = new ModalBuilder()
              .setCustomId(`rrmodal:setexclusions:${menuId}`)
              .setTitle("Exclusions JSON")
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("json")
                    .setLabel("Exclusions JSON")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                )
              );
            return interaction.showModal(modal);
          }
        }
      }

      if (ctx === "rrbtn" && action === "toggle") {
        const rid = menuId; // for rrbtn:toggle::roleId
        const member = interaction.member;
        if (member.roles.cache.has(rid)) await member.roles.remove(rid);
        else await member.roles.add(rid);
        return interaction.reply({ content: "✅ Toggled", ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");
      if (parts[0] === "rrmodal") {
        const sub = parts[1], type = parts[2], menuId = parts[3];
        switch (sub) {
          case "create": {
            const name = interaction.fields.getTextInputValue("name").trim();
            const desc = interaction.fields.getTextInputValue("desc").trim();
            const id = db.createMenu(interaction.guild.id, name, desc);
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`rr:type:dropdown:${id}`).setLabel("Dropdown").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`rr:type:button:${id}`).setLabel("Buttons").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`rr:type:both:${id}`).setLabel("Both").setStyle(ButtonStyle.Success)
            );
            return interaction.reply({ content: `Menu created: ${id}`, components: [row], ephemeral: true });
          }
          case "addemojis": {
            const emojis = {};
            for (const [k,input] of interaction.fields.fields) {
              const v = input.value.trim(); if (v) emojis[k]=v;
            }
            db.saveEmojis(menuId, emojis, type);
            return interaction.reply({ content: `✅ Emojis saved for ${type}`, ephemeral: true });
          }
          case "setlimits": {
            const max = parseInt(interaction.fields.getTextInputValue("max"),10)||0;
            db.saveLimits(menuId, max);
            return interaction.reply({ content: `✅ Max roles: ${max}`, ephemeral: true });
          }
          case "setexclusions": {
            const raw = interaction.fields.getTextInputValue("json");
            const obj = safeJSON(raw, {});
            db.saveExclusions(menuId, obj);
            return interaction.reply({ content: "✅ Exclusions saved", ephemeral: true });
          }
        }
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rrselectroles:")) {
      const [ , , type, menuId ] = interaction.customId.split(":");
      db.saveRoles(menuId, interaction.values, type);
      const m = db.getMenu(menuId);
      const next = m.selectionType.includes("dropdown") && !m.dropdownRoles.length ? "dropdown"
                 : m.selectionType.includes("button")   && !m.buttonRoles.length ? "button"
                 : null;
      if (next) {
        const all = interaction.guild.roles.cache.filter(r=>!r.managed&&r.id!==interaction.guild.id);
        const select = new StringSelectMenuBuilder()
          .setCustomId(`rrselectroles:${next}:${menuId}`)
          .setMinValues(1).setMaxValues(Math.min(all.size,25))
          .addOptions(all.map(r=>({ label:r.name,value:r.id })));
        return interaction.update({ content:`Select ${next} roles:`, components:[new ActionRowBuilder().addComponents(select)] });
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rr:addemojis:dropdown:${menuId}`).setLabel("Add Emojis (Dropdown)").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`rr:addemojis:button:${menuId}`).setLabel("Add Emojis (Buttons)").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`rr:setlimits:${menuId}`).setLabel("Set Limits").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`rr:setexclusions:${menuId}`).setLabel("Set Exclusions").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("Publish").setStyle(ButtonStyle.Success)
      );
      return interaction.update({ content:"✅ Roles saved. Configure or publish below.", components:[row] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:use:")) {
      const menuId = interaction.customId.split(":")[2];
      const m = db.getMenu(menuId);
      if (!m) return interaction.reply({ content:"Menu not found", ephemeral:true });
      const member = interaction.member;
      for (const rid of m.dropdownRoles) {
        if (interaction.values.includes(rid)) {
          if (!member.roles.cache.has(rid)) await member.roles.add(rid);
        } else {
          if (member.roles.cache.has(rid)) await member.roles.remove(rid);
        }
      }
      return interaction.reply({ content:"✅ Updated roles", ephemeral:true });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) interaction.reply({ content:"❌ Something went wrong", ephemeral:true }).catch(() => {});
  }
});

async function showMenus(interaction) {
  const menus = db.getMenus(interaction.guild.id);
  const embed = new EmbedBuilder()
    .setTitle("Reaction Role Menus")
    .setDescription(menus.length?menus.map(m=>m.name).join("\n"):"No menus");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rr:create").setLabel("Create New").setStyle(ButtonStyle.Success)
  );
  await interaction.update({ embeds:[embed], components:[row] });
}

async function publishMenu(interaction, menuId) {
  const m = db.getMenu(menuId);
  if (!m) return interaction.reply({ content:"Menu not found", ephemeral:true });
  const embed = new EmbedBuilder().setTitle(m.name).setDescription(m.desc);
  const comps = [];
  if (m.selectionType.includes("dropdown") && m.dropdownRoles.length) {
    const opts = m.dropdownRoles.map(rid=>{
      const role = interaction.guild.roles.cache.get(rid);
      if (!role) return null;
      const emo = m.dropdownEmojis[rid];
      return { label:role.name, value:rid, emoji: emo? parseEmoji(emo):undefined };
    }).filter(Boolean);
    comps.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`rr:use:${menuId}`)
        .setMinValues(0)
        .setMaxValues(opts.length)
        .addOptions(opts)
    ));
  }
  if (m.selectionType.includes("button") && m.buttonRoles.length) {
    const btns = m.buttonRoles.map(rid=>{
      const role = interaction.guild.roles.cache.get(rid);
      if (!role) return null;
      const b = new ButtonBuilder().setCustomId(`rrbtn:toggle::${rid}`).setLabel(role.name).setStyle(ButtonStyle.Primary);
      const emo = m.buttonEmojis[rid]; if (emo) try{b.setEmoji(parseEmoji(emo))}catch{};
      return b;
    }).filter(Boolean);
    for (let i=0; i<btns.length; i+=5) comps.push(new ActionRowBuilder().addComponents(btns.slice(i,i+5)));
  }
  const msg = await interaction.channel.send({ embeds:[embed], components:comps });
  db.saveMessageId(menuId, interaction.channel.id, msg.id);
  return interaction.reply({ content:"🚀 Published!", ephemeral:true });
}

client.login(process.env.TOKEN);
