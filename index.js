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
  InteractionCollector,
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
      dropdownRoles: [],        // { roleId, emoji? }
      buttonRoles: [],          // { roleId, emoji? }
      selectionType: [],        // ['dropdown','button','both']
      channelId: null,
      messageId: null,
      limits: { maxRoles: 0 },  // 0 = no limit
      exclusions: {},           // JSON object
    });
    return id;
  },
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map((id) => ({ id, ...this.menuData.get(id) }));
  },
  saveRoles(menuId, roles, type) {
    // roles: array of role IDs, stored with empty emoji placeholders initially
    const arr = roles.map((r) => ({ roleId: r, emoji: null }));
    if (type === "dropdown") this.menuData.get(menuId).dropdownRoles = arr;
    if (type === "button") this.menuData.get(menuId).buttonRoles = arr;
  },
  saveRoleEmojis(menuId, type, roleEmojiMap) {
    // roleEmojiMap = { roleId: emojiString }
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    let arr = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
    arr.forEach((r) => {
      if (roleEmojiMap[r.roleId]) r.emoji = roleEmojiMap[r.roleId];
    });
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
  saveLimits(menuId, limits) {
    const m = this.menuData.get(menuId);
    m.limits = limits;
  },
  saveExclusions(menuId, exclusions) {
    const m = this.menuData.get(menuId);
    m.exclusions = exclusions;
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
          // Modal to enter menu name & description
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

        if (action === "type") {
          // User chose dropdown / button / both
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(menuId, selectedTypes);

          // Ask to select roles for the first type
          const firstType = selectedTypes[0];
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          if (!allRoles.size)
            return interaction.reply({ content: "❌ No roles available to select.", ephemeral: true });

          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${firstType}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.update({
            content: `✅ Selection type saved. Now select roles for **${firstType}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }

        if (action === "publish") {
          return publishMenu(interaction, extra);
        }

        // Emoji modals and limit/exclusion modals buttons
        if (action === "emojis") {
          // open modal to input emojis for roles of the given type
          const type = extra; // 'dropdown' or 'button'
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

          const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
          if (!roles.length)
            return interaction.reply({ content: `❌ No ${type} roles to add emojis to.`, ephemeral: true });

          // build a modal with a text input per role showing the current emoji or empty
          const modal = new ModalBuilder().setCustomId(`rr:modal:emojis:${type}:${menuId}`).setTitle(`Add Emojis to ${type} roles`);

          // Discord modal max 5 components, so if >5 roles, paginate or just limit to 5
          // Here just take first 5 roles for emoji input for simplicity
          roles.slice(0, 5).forEach((r, i) => {
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(r.roleId)
                  .setLabel(`Emoji for role: ${interaction.guild.roles.cache.get(r.roleId)?.name || "Unknown"}`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setMaxLength(50)
                  .setPlaceholder("Enter emoji or leave blank")
                  .setValue(r.emoji || "")
              )
            );
          });

          return interaction.showModal(modal);
        }

        if (action === "limits") {
          // modal for max roles limit
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:limits:${menuId}`)
            .setTitle("Set Role Selection Limits")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("maxRoles")
                  .setLabel("Max number of roles a user can have from this menu (0 = no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("0")
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "exclusions") {
          // modal for exclusions JSON input
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:exclusions:${menuId}`)
            .setTitle("Set Role Exclusions (JSON)")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("exclusionsJson")
                  .setLabel("Enter exclusions JSON")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder(
                    'Example: {"region": ["roleId1", "roleId2", "roleId3"]}\nWhen one role in a group is assigned, the others are removed.'
                  )
                  .setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }
      }

      if (ctx === "rr" && action === "edit") {
        // Show edit options: add emojis, set limits, set exclusions, publish, back
        const menu = db.getMenu(extra);
        if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:emojis:dropdown:${extra}`).setLabel("Add Dropdown Emojis").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:emojis:button:${extra}`).setLabel("Add Button Emojis").setStyle(ButtonStyle.Primary)
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:limits:${extra}`).setLabel("Set Role Limits").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`rr:exclusions:${extra}`).setLabel("Set Exclusions").setStyle(ButtonStyle.Secondary)
        );
        const row3 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:publish:${extra}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
          .setTitle(`Edit Menu: ${menu.name}`)
          .setDescription(`Use the buttons below to configure emojis, limits, exclusions, or publish.`);

        return interaction.update({ embeds: [embed], components: [row1, row2, row3] });
      }
    }

    if (interaction.isModalSubmit()) {
      const [ctx, modalType, subType, menuId] = interaction.customId.split(":");
      if (ctx !== "rr") return;

      if (modalType === "create") {
        const name = interaction.fields.getTextInputValue("name").trim();
        const desc = interaction.fields.getTextInputValue("desc").trim();

        if (!name) return interaction.reply({ content: "❌ Menu name cannot be empty.", ephemeral: true });
        const menuId = db.createMenu(interaction.guild.id, name, desc);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:type:dropdown:${menuId}`).setLabel("Use Dropdown").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:button:${menuId}`).setLabel("Use Buttons").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:type:both:${menuId}`).setLabel("Use Both").setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ content: "Choose how users should select roles:", components: [row], ephemeral: true });
      }

      if (modalType === "emojis") {
        const type = subType; // dropdown or button
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

        const roleEmojiMap = {};
        // Loop through all inputs (role IDs as customIds)
        for (const [key, value] of Object.entries(interaction.fields.fields)) {
          const emojiInput = value.value.trim();
          if (emojiInput) roleEmojiMap[key] = emojiInput;
        }

        // Save emoji mapping for roles of this type
        db.saveRoleEmojis(menuId, type, roleEmojiMap);

        return interaction.reply({ content: `✅ Saved emojis for ${type} roles.`, ephemeral: true });
      }

      if (modalType === "limits") {
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

        const maxRolesInput = interaction.fields.getTextInputValue("maxRoles").trim();
        const maxRoles = parseInt(maxRolesInput, 10);
        if (isNaN(maxRoles) || maxRoles < 0)
          return interaction.reply({ content: "❌ Invalid max roles limit (must be 0 or positive integer).", ephemeral: true });

        db.saveLimits(menuId, { maxRoles });

        return interaction.reply({ content: `✅ Saved role selection limit: ${maxRoles}`, ephemeral: true });
      }

      if (modalType === "exclusions") {
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

        const rawJson = interaction.fields.getTextInputValue("exclusionsJson").trim();

        if (rawJson) {
          try {
            const exclusions = JSON.parse(rawJson);
            if (typeof exclusions !== "object" || Array.isArray(exclusions))
              throw new Error("Exclusions must be a JSON object.");
            // Save exclusions JSON object
            db.saveExclusions(menuId, exclusions);
            return interaction.reply({ content: `✅ Saved exclusions.`, ephemeral: true });
          } catch (e) {
            return interaction.reply({ content: `❌ Invalid JSON: ${e.message}`, ephemeral: true });
          }
        } else {
          // Empty input clears exclusions
          db.saveExclusions(menuId, {});
          return interaction.reply({ content: `✅ Cleared exclusions.`, ephemeral: true });
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("rr:selectroles:")) {
        const [_, __, type, menuId] = interaction.customId.split(":");
        if (!interaction.values.length) return interaction.reply({ content: "❌ No roles selected.", ephemeral: true });

        db.saveRoles(menuId, interaction.values, type);

        // Check if more role types to select
        const menu = db.getMenu(menuId);
        const selectionTypes = menu.selectionType;

        // Find next type that still needs roles selected
        const nextType = selectionTypes.find((t) => {
          if (t === "dropdown") return menu.dropdownRoles.length === 0;
          if (t === "button") return menu.buttonRoles.length === 0;
          return false;
        });

        if (nextType) {
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${nextType}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.update({
            content: `✅ Saved roles for ${type}. Now select roles for **${nextType}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }

        // All roles selected, offer buttons to add emojis, limits, exclusions, or publish
        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:emojis:dropdown:${menuId}`).setLabel("Add Dropdown Emojis").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rr:emojis:button:${menuId}`).setLabel("Add Button Emojis").setStyle(ButtonStyle.Primary)
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:limits:${menuId}`).setLabel("Set Role Limits").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`rr:exclusions:${menuId}`).setLabel("Set Exclusions").setStyle(ButtonStyle.Secondary)
        );
        const row3 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr:publish:${menuId}`).setLabel("🚀 Publish").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("dash:back").setLabel("🔙 Back").setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
          content: "✅ All roles saved. You can add emojis, set limits/exclusions, or publish.",
          components: [row1, row2, row3],
        });
      }

      if (interaction.customId.startsWith("rr:use:")) {
        // User uses dropdown to select roles
        const menuId = interaction.customId.split(":")[2];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "❌ Menu not found.", ephemeral: true });

        const chosen = interaction.values;
        const member = interaction.member;

        // Enforce role limit
        if (menu.limits.maxRoles > 0) {
          // Count how many roles from this menu the member already has
          const currentRoles = member.roles.cache.filter((r) =>
            menu.dropdownRoles.some((dr) => dr.roleId === r.id)
          );

          const chosenSet = new Set(chosen);
          const toAdd = chosen.filter((r) => !currentRoles.has(r));

          if (toAdd.length + currentRoles.size - (currentRoles.size - chosen.length) > menu.limits.maxRoles) {
            return interaction.reply({
              content: `❌ You can only have a maximum of ${menu.limits.maxRoles} role(s) from this menu.`,
              ephemeral: true,
            });
          }
        }

        // Assign chosen roles & remove unchosen roles from dropdownRoles
        for (const r of menu.dropdownRoles) {
          const has = member.roles.cache.has(r.roleId);
          if (chosen.includes(r.roleId)) {
            if (!has) await member.roles.add(r.roleId);
          } else {
            if (has) await member.roles.remove(r.roleId);
          }
        }

        // Handle exclusions
        handleExclusions(member, menu, chosen);

        return interaction.reply({ content: "✅ Your roles have been updated!", ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("rr:assign:")) {
      // User clicked button to toggle role
      const roleId = interaction.customId.split(":")[2];
      const member = interaction.member;

      // Find which menu this role belongs to (buttons only)
      let menu = null;
      for (const m of db.menuData.values()) {
        if (m.buttonRoles.some((r) => r.roleId === roleId)) {
          menu = m;
          break;
        }
      }
      if (!menu) return interaction.reply({ content: "❌ Role menu not found.", ephemeral: true });

      const hasRole = member.roles.cache.has(roleId);

      // Enforce role limit
      if (!hasRole && menu.limits.maxRoles > 0) {
        const currentCount = member.roles.cache.filter((r) =>
          menu.buttonRoles.some((br) => br.roleId === r.id)
        ).size;
        if (currentCount >= menu.limits.maxRoles) {
          return interaction.reply({
            content: `❌ You can only have a maximum of ${menu.limits.maxRoles} role(s) from this menu.`,
            ephemeral: true,
          });
        }
      }

      if (hasRole) await member.roles.remove(roleId);
      else await member.roles.add(roleId);

      // After toggling, handle exclusions for buttons
      const updatedRoles = member.roles.cache.filter((r) =>
        menu.buttonRoles.some((br) => br.roleId === r.id)
      ).map((r) => r.id);

      handleExclusions(member, menu, updatedRoles);

      return interaction.reply({
        content: `✅ You have ${hasRole ? "removed" : "added"} <@&${roleId}>.`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "❌ Something went wrong.", ephemeral: true });
    } else {
      await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
    }
  }
});

// Helper: handle exclusions on a member
async function handleExclusions(member, menu, chosenRoleIds) {
  if (!menu.exclusions) return;
  // exclusions: { groupName: [roleId1, roleId2, ...], ... }
  // For each group, if user has a role in group, remove other roles from group not selected
  const guildRoles = member.guild.roles.cache;
  for (const groupRoles of Object.values(menu.exclusions)) {
    if (!Array.isArray(groupRoles)) continue;
    const hasGroupRoles = groupRoles.filter((r) => member.roles.cache.has(r));
    if (hasGroupRoles.length > 1) {
      // If member has multiple conflicting roles, remove extras (keep the first)
      for (let i = 1; i < hasGroupRoles.length; i++) {
        await member.roles.remove(hasGroupRoles[i]).catch(() => {});
      }
    } else if (hasGroupRoles.length === 1) {
      // Remove roles in group not selected (enforce exclusivity)
      for (const r of groupRoles) {
        if (r !== hasGroupRoles[0] && member.roles.cache.has(r)) {
          await member.roles.remove(r).catch(() => {});
        }
      }
    }

    // If user selected a role in this group, remove others not selected
    for (const r of groupRoles) {
      if (chosenRoleIds.includes(r)) {
        for (const other of groupRoles) {
          if (other !== r && member.roles.cache.has(other)) {
            await member.roles.remove(other).catch(() => {});
          }
        }
      }
    }
  }
}

async function sendMainDashboard(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("🛠️ Server Dashboard")
    .setDescription("Click a button to configure:");

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

  // Dropdown
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    const options = menu.dropdownRoles.map(({ roleId, emoji }) => {
      const role = interaction.guild.roles.cache.get(roleId);
      return {
        label: role?.name || "Unknown",
        value: roleId,
        emoji: emoji || undefined,
      };
    });

    const dropdown = new StringSelectMenuBuilder()
      .setCustomId(`rr:use:${menuId}`)
      .setMinValues(0)
      .setMaxValues(options.length)
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(dropdown));
  }

  // Buttons
  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    const buttons = menu.buttonRoles.map(({ roleId, emoji }) => {
      const role = interaction.guild.roles.cache.get(roleId);
      const btn = new ButtonBuilder()
        .setCustomId(`rr:assign:${roleId}`)
        .setLabel(role?.name || "Unknown")
        .setStyle(ButtonStyle.Secondary);
      if (emoji) {
        // Try to parse emoji properly (Discord accepts custom emojis as string or object with id/name)
        // We'll just pass emoji string for simplicity, works for unicode and custom emoji in string form
        btn.setEmoji(emoji);
      }
      return btn;
    });

    // Discord allows max 5 buttons per ActionRow
    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  const msg = await interaction.channel.send({ embeds: [embed], components });
  db.saveMessageId(menuId, interaction.channel.id, msg.id);

  await interaction.update({ content: "🚀 Published!", components: [] });
}

client.login(process.env.TOKEN);
