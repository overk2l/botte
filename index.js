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

// In‑memory storage; swap for a real DB as needed
const db = {
  menus: new Map(),       // guildId -> array of menuIds
  menuData: new Map(),    // menuId -> menu object

  createMenu(guildId, name, desc) {
    const id = Date.now().toString();
    if (!this.menus.has(guildId)) this.menus.set(guildId, []);
    this.menus.get(guildId).push(id);
    this.menuData.set(id, {
      guildId,
      name,
      desc,
      selectionType: [],   // e.g. ['dropdown','button']
      dropdownRoles: [],
      buttonRoles: [],
      dropdownEmojis: {},  // roleId -> emoji string
      buttonEmojis: {},    // roleId -> emoji string
      exclusions: {},      // roleId -> [roleIdToRemove,...]
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

  saveExclusions(menuId, map) {
    const m = this.menuData.get(menuId);
    if (m) m.exclusions = map;
  },

  saveMessageId(menuId, channelId, messageId) {
    const m = this.menuData.get(menuId);
    if (m) {
      m.channelId = channelId;
      m.messageId = messageId;
    }
  },
};

// Parse a user‑entered emoji string into Discord.js emoji spec
function parseEmoji(emoji) {
  if (!emoji) return undefined;
  const custom = emoji.match(/^<a?:([^:]+):(\d+)>$/);
  if (custom) return { id: custom[2], name: custom[1], animated: emoji.startsWith("<a:") };
  return { name: emoji };
}

// Remove any roles mapped under the selected ones
function applyExclusions(member, menu, selectedRoleIds) {
  const map = menu.exclusions || {};
  for (const roleId of selectedRoleIds) {
    const toRemove = map[roleId];
    if (Array.isArray(toRemove)) {
      toRemove.forEach(badId => {
        if (member.roles.cache.has(badId)) member.roles.remove(badId).catch(() => {});
      });
    }
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST().setToken(process.env.TOKEN);
  const dashCmd = new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Open the guild dashboard")
    .toJSON();
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [dashCmd] });
  console.log("📑 /dashboard deployed");
});

client.on("interactionCreate", async interaction => {
  try {
    // Slash /dashboard
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("dash:reactionroles").setLabel("Reaction Roles").setStyle(ButtonStyle.Primary)
      );
      return interaction.reply({ content: "🛠️ Dashboard", components: [row], ephemeral: true });
    }

    // Button clicks
    if (interaction.isButton()) {
      const [ctx, action, type, menuId] = interaction.customId.split(":");
      // Dashboard nav
      if (ctx === "dash") {
        if (action === "reactionroles") return showMenus(interaction);
        if (action === "back") return interaction.update({ content: "🛠️ Dashboard", components: [], ephemeral: true });
      }
      // Reaction‑role flow
      if (ctx === "rr") {
        // Create menu modal
        if (action === "create") {
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
        // Select dropdown/buttons/both
        if (action === "type") {
          const types = type === "both" ? ["dropdown", "button"] : [type];
          db.saveSelectionType(menuId, types);
          const next = types.includes("dropdown") ? "dropdown" : "button";
          const all = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);
          const menu = db.getMenu(menuId);
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${next}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(all.size, 25))
            .addOptions(all.map(r => ({ label: r.name, value: r.id })));
          return interaction.update({
            content: `✅ Saved selectionType. Now pick **${next}** roles:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }
        // After roles chosen: show config buttons
        if (action === "config") {
          const menu = db.getMenu(menuId);
          const embed = new EmbedBuilder()
            .setTitle(`⚙️ Configure ${menu.name}`)
            .setDescription(menu.desc)
            .addFields(
              { name: "Type", value: menu.selectionType.join(" + ") || "-", inline: true },
              { name: "Dropdown count", value: `${menu.dropdownRoles.length}`, inline: true },
              { name: "Button count", value: `${menu.buttonRoles.length}`, inline: true }
            );
          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`rr:addemoji:dropdown:${menuId}`)
              .setLabel("🎨 Dropdown Emojis")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(!menu.dropdownRoles.length),
            new ButtonBuilder()
              .setCustomId(`rr:addemoji:button:${menuId}`)
              .setLabel("🎨 Button Emojis")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(!menu.buttonRoles.length),
            new ButtonBuilder()
              .setCustomId(`rr:setexclusions:${menuId}`)
              .setLabel("🚫 Set Exclusions")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Success)
          );
          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("dash:reactionroles").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
          );
          return interaction.update({ embeds: [embed], components: [row1, row2] });
        }
        // Show exclusions modal
        if (action === "setexclusions") {
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setexclusions:${menuId}`)
            .setTitle("Role Exclusions Mapping")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("exclusions")
                  .setLabel("Paste JSON map")
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder(`{
  "ROLE_ID_EU": ["ROLE_ID_NA","ROLE_ID_ASIA"],
  "ROLE_ID_NA": ["ROLE_ID_EU","ROLE_ID_ASIA"]
}`)
                  .setRequired(false)
              )
            );
          return interaction.showModal(modal);
        }
        // Publish immediately
        if (action === "publish") {
          return publishMenu(interaction, menuId);
        }
      }
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");
      // Create menu
      if (parts[0] === "rr" && parts[2] === "create") {
        const name = interaction.fields.getTextInputValue("name").trim();
        const desc = interaction.fields.getTextInputValue("desc").trim();
        const id = db.createMenu(interaction.guild.id, name, desc);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:type:dropdown:${id}`).setLabel("Dropdown").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:button:${id}`).setLabel("Buttons").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:both:${id}`).setLabel("Both").setStyle(ButtonStyle.Success)
        );
        return interaction.reply({ content: `Menu ${id} created`, components: [row], ephemeral: true });
      }
      // Save exclusions map
      if (parts[2] === "setexclusions") {
        const menuId = parts[3];
        const raw = interaction.fields.getTextInputValue("exclusions").trim();
        let map = {};
        if (raw) {
          try { map = JSON.parse(raw); }
          catch { return interaction.reply({ content: "❌ Invalid JSON.", ephemeral: true }); }
        }
        db.getMenu(menuId).exclusions = map;
        return interaction.reply({ content: "✅ Exclusions saved.", ephemeral: true });
      }
    }

    // Role selection steps
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:selectroles:")) {
      const [, , type, menuId] = interaction.customId.split(":");
      db.saveRoles(menuId, interaction.values, type);
      const menu = db.getMenu(menuId);
      // next step?
      const need = menu.selectionType.includes("dropdown") && !menu.dropdownRoles.length
        ? "dropdown"
        : menu.selectionType.includes("button") && !menu.buttonRoles.length
        ? "button"
        : null;
      if (need) {
        const all = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);
        const select = new StringSelectMenuBuilder()
          .setCustomId(`rr:selectroles:${need}:${menuId}`)
          .setMinValues(1)
          .setMaxValues(Math.min(all.size,25))
          .addOptions(all.map(r=>({ label:r.name, value:r.id })));
        return interaction.update({
          content: `✅ Saved ${type}. Now pick ${need}:`,
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }
      // done picking: show config
      return showConfigRow(interaction, menuId);
    }

    // Dropdown usage by user
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:use:")) {
      const menuId = interaction.customId.split(":")[2];
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });
      const sel = interaction.values;
      const member = interaction.member;
      // apply toggles
      for (const rid of menu.dropdownRoles) {
        if (sel.includes(rid)) {
          if (!member.roles.cache.has(rid)) member.roles.add(rid);
        } else {
          if (member.roles.cache.has(rid)) member.roles.remove(rid);
        }
      }
      // apply exclusions after
      applyExclusions(member, menu, sel);
      return interaction.reply({ content: "✅ Updated!", ephemeral: true });
    }

    // Button usage by user
    if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
      const roleId = interaction.customId.split(":")[2];
      const member = interaction.member;
      const has = member.roles.cache.has(roleId);
      const menu = [...db.menuData.values()].find(m => m.buttonRoles.includes(roleId));
      if (!has) {
        // apply exclusions before adding
        applyExclusions(member, menu, [roleId]);
        await member.roles.add(roleId);
      } else {
        await member.roles.remove(roleId);
      }
      return interaction.reply({ content: `✅ ${has?"Removed":"Added"} <@&${roleId}>`, ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) interaction.reply({ content: "❌ Something went wrong.", ephemeral: true }).catch(() => {});
  }
});

// Show all menus and “Create” button
async function showMenus(interaction) {
  const list = db.getMenus(interaction.guild.id);
  const embed = new EmbedBuilder()
    .setTitle("🎨 Reaction Role Menus")
    .setDescription(list.length ? list.map((m,i) => `**${i+1}.** ${m.name}`).join("\n") : "*None yet*");
  const buttons = [
    new ButtonBuilder().setCustomId("rr:create").setLabel("➕ Create").setStyle(ButtonStyle.Success)
  ];
  list.slice(0,3).forEach((m,i)=>buttons.push(
    new ButtonBuilder().setCustomId(`rr:config:${m.id}`).setLabel(`⚙️ ${i+1}`).setStyle(ButtonStyle.Primary)
  ));
  buttons.push(new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary));
  await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] });
}

// Show the config row after roles‐picked
function showConfigRow(interaction, menuId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rr:config:${menuId}`).setLabel("⚙️ Configure").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish Now").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("dash:reactionroles").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
  );
  return interaction.update({ content: "✅ Roles saved—now configure or publish.", components: [row] });
}

// Publish the menu to channel
async function publishMenu(interaction, menuId) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle(menu.name)
    .setDescription(menu.desc)
    .setFooter({ text: "Pick a role below!" });

  const comps = [];

  // Dropdown
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const opts = menu.dropdownRoles.map(rid => {
      const role = interaction.guild.roles.cache.get(rid);
      if (!role) return null;
      const emo = menu.dropdownEmojis[rid];
      return { label: role.name, value: rid, emoji: emo? parseEmoji(emo): undefined };
    }).filter(Boolean);
    comps.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`rr:use:${menuId}`)
        .setMinValues(0)
        .setMaxValues(opts.length)
        .addOptions(opts)
    ));
  }

  // Buttons
  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const btns = menu.buttonRoles.map(rid => {
      const role = interaction.guild.roles.cache.get(rid);
      if (!role) return null;
      const b = new ButtonBuilder()
        .setCustomId(`rr:assign:${rid}`)
        .setLabel(role.name)
        .setStyle(ButtonStyle.Secondary);
      const emo = menu.buttonEmojis[rid];
      if (emo) try { b.setEmoji(parseEmoji(emo)); } catch {}
      return b;
    }).filter(Boolean);
    for (let i=0; i<btns.length; i+=5) comps.push(new ActionRowBuilder().addComponents(btns.slice(i,i+5)));
  }

  if (!comps.length) {
    return interaction.reply({ content: "❌ Nothing to publish.", ephemeral: true });
  }

  await interaction.channel.send({ embeds: [embed], components: comps });
  return interaction.reply({ content: "🚀 Published!", ephemeral: true });
}

client.login(process.env.TOKEN);
