// index.js (Full updated: dropdown + buttons + emojis + limits + exclusions + modals)
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
  menus: new Map(), // guildId => [menuIds]
  menuData: new Map(), // menuId => { guildId, name, desc, dropdownRoles, buttonRoles, dropdownEmojis, buttonEmojis, limits, exclusions, selectionType, channelId, messageId }

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
      dropdownEmojis: {}, // roleId => emoji string
      buttonEmojis: {}, // roleId => emoji string
      limits: { dropdown: 0, button: 0 }, // 0 means no limit
      exclusions: {}, // JSON object of exclusions
      selectionType: [],
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

  saveRoles(menuId, roles, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    if (type === "dropdown") menu.dropdownRoles = roles;
    if (type === "button") menu.buttonRoles = roles;
  },

  saveEmojis(menuId, emojis, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    if (type === "dropdown") menu.dropdownEmojis = emojis;
    if (type === "button") menu.buttonEmojis = emojis;
  },

  saveLimits(menuId, limits) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.limits = limits;
  },

  saveExclusions(menuId, exclusions) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.exclusions = exclusions;
  },

  saveSelectionType(menuId, types) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.selectionType = types;
  },

  saveMessageId(menuId, channelId, messageId) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    menu.channelId = channelId;
    menu.messageId = messageId;
  },
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName("dashboard")
      .setDescription("Open the guild dashboard"),
  ].map(cmd => cmd.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log("📑 /dashboard command deployed");
});

// Helper to create emoji object for discord builders
function parseEmojiString(emojiStr) {
  // emojiStr can be unicode emoji or <a:name:id> custom emoji
  if (!emojiStr) return null;
  emojiStr = emojiStr.trim();
  if (emojiStr.startsWith("<") && emojiStr.endsWith(">")) {
    // custom emoji
    const animated = emojiStr.startsWith("<a:");
    const match = emojiStr.match(/<(a?):(\w+):(\d+)>/);
    if (!match) return null;
    return {
      id: match[3],
      name: match[2],
      animated: animated,
    };
  }
  // unicode emoji
  return emojiStr;
}

// Parse JSON safely helper
function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Remove roles in exclusions logic
async function applyExclusions(member, menu, newRolesIds) {
  // exclusions example: { "region": ["roleId1", "roleId2"] }
  // For each exclusion group, if user selects a role in that group, remove all other roles in the group
  if (!menu.exclusions) return;
  for (const groupName in menu.exclusions) {
    const rolesInGroup = menu.exclusions[groupName]; // array of roleIds
    // Check if user selected any role in this group
    const selectedInGroup = rolesInGroup.filter(r => newRolesIds.includes(r));
    if (selectedInGroup.length === 0) continue;

    // Remove all other roles in this group user has but didn't select now
    for (const roleId of rolesInGroup) {
      if (!selectedInGroup.includes(roleId) && member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => {});
      }
    }
  }
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "dashboard") {
        return sendMainDashboard(interaction);
      }
    }

    if (interaction.isButton()) {
      const [ctx, action, extra, menuId] = interaction.customId.split(":");

      if (ctx === "dash") {
        if (action === "reaction-roles") return showReactionRolesDashboard(interaction);
        if (action === "back") return sendMainDashboard(interaction);
      }

      if (ctx === "rr") {
        if (action === "create") {
          // Show modal to create new menu (name + desc)
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
                  .setPlaceholder("Example: Region Roles")
                  .setRequired(true)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("desc")
                  .setLabel("Embed Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setMaxLength(200)
                  .setPlaceholder("Describe what this menu does")
                  .setRequired(true)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "type") {
          // Save selection type, e.g. dropdown, button, both
          let selectedTypes = extra === "both" ? ["dropdown", "button"] : [extra];
          db.saveSelectionType(menuId, selectedTypes);

          // Begin role selection for first type
          const firstType = selectedTypes[0];
          const allRoles = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);
          if (!allRoles.size) {
            return interaction.reply({ content: "No roles found on server.", ephemeral: true });
          }
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${firstType}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(
              allRoles.map(r => ({
                label: r.name,
                value: r.id,
              }))
            );

          return interaction.update({
            content: `✅ Selection type saved. Now select roles for **${firstType}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }

        if (action === "publish") {
          // Publish menu to channel
          return publishMenu(interaction, extra);
        }

        if (action === "setlimits") {
          // Show modal to input role limits for dropdown and buttons
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setlimits:${menuId}`)
            .setTitle("Set Role Limits (0 = no limit)")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("dropdownLimit")
                  .setLabel("Dropdown max selectable roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("Enter a number (0 = no limit)")
                  .setRequired(true)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("buttonLimit")
                  .setLabel("Button max selectable roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("Enter a number (0 = no limit)")
                  .setRequired(true)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "setexclusions") {
          // Show modal to input exclusions JSON
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setexclusions:${menuId}`)
            .setTitle("Set Role Exclusions (JSON)")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("exclusions")
                  .setLabel("Enter exclusions JSON")
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder(
                    `Example:\n{\n  "region": ["roleId1", "roleId2"],\n  "team": ["roleId3", "roleId4"]\n}`
                  )
                  .setRequired(false)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "addemojis") {
          // Show modal to input emojis for roles for a type (dropdown or button)
          const type = extra; // dropdown or button
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

          // Compose label and placeholder text listing roles to set emojis for
          const rolesToEmoji = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
          if (!rolesToEmoji.length)
            return interaction.reply({ content: `No ${type} roles found for emoji input.`, ephemeral: true });

          // Modal supports max 5 text inputs. We'll chunk roles by 5 per modal and ask repeatedly.
          // For simplicity, show first 5 roles for emojis per modal.
          // Store progress in menuData, fallback to simplest approach: one modal per role — sequentially handled
          // Here, for simplicity, we make one modal with 5 emoji inputs named emoji1..emoji5 for the first 5 roles

          // We also save a "emojiIndex" in menuData to track which roles we are on.
          if (!menu._emojiIndex) menu._emojiIndex = { dropdown: 0, button: 0 };
          const startIndex = menu._emojiIndex[type] || 0;
          const chunkRoles = rolesToEmoji.slice(startIndex, startIndex + 5);

          const modal = new ModalBuilder().setCustomId(`rr:modal:addemojis:${type}:${menuId}`).setTitle(`Add Emojis for ${type} Roles`);

          chunkRoles.forEach((roleId, i) => {
            const role = interaction.guild.roles.cache.get(roleId);
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(`emoji_${i}`)
                  .setLabel(`Emoji for: ${role?.name || "Unknown Role"}`)
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("Enter emoji (unicode or custom)")
                  .setRequired(false)
              )
            );
          });

          return interaction.showModal(modal);
        }
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "rr:modal:create") {
        // Create menu modal submit
        const name = interaction.fields.getTextInputValue("name");
        const desc = interaction.fields.getTextInputValue("desc");
        if (!name || !desc) return interaction.reply({ content: "Name and description are required.", ephemeral: true });

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
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith("rr:modal:setlimits:")) {
        const menuId = interaction.customId.split(":")[3];
        const dropdownLimitStr = interaction.fields.getTextInputValue("dropdownLimit");
        const buttonLimitStr = interaction.fields.getTextInputValue("buttonLimit");

        const dropdownLimit = Number(dropdownLimitStr);
        const buttonLimit = Number(buttonLimitStr);

        if (
          Number.isNaN(dropdownLimit) ||
          Number.isNaN(buttonLimit) ||
          dropdownLimit < 0 ||
          buttonLimit < 0
        ) {
          return interaction.reply({ content: "Invalid limits provided.", ephemeral: true });
        }

        db.saveLimits(menuId, { dropdown: dropdownLimit, button: buttonLimit });

        return interaction.reply({ content: "✅ Role limits saved.", ephemeral: true });
      }

      if (interaction.customId.startsWith("rr:modal:setexclusions:")) {
        const menuId = interaction.customId.split(":")[3];
        const exclusionsStr = interaction.fields.getTextInputValue("exclusions");
        if (!exclusionsStr) {
          db.saveExclusions(menuId, {});
          return interaction.reply({ content: "Exclusions cleared.", ephemeral: true });
        }
        const exclusions = safeParseJSON(exclusionsStr);
        if (!exclusions || typeof exclusions !== "object") {
          return interaction.reply({ content: "Invalid JSON for exclusions.", ephemeral: true });
        }
        db.saveExclusions(menuId, exclusions);
        return interaction.reply({ content: "✅ Exclusions saved.", ephemeral: true });
      }

      if (interaction.customId.startsWith("rr:modal:addemojis:")) {
        const [, , type, menuId] = interaction.customId.split(":");
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

        // Roles for this type
        const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
        if (!roles.length) return interaction.reply({ content: "No roles to add emojis for.", ephemeral: true });

        if (!menu._emojiIndex) menu._emojiIndex = { dropdown: 0, button: 0 };
        const startIndex = menu._emojiIndex[type] || 0;
        const chunkRoles = roles.slice(startIndex, startIndex + 5);

        const emojis = type === "dropdown" ? { ...menu.dropdownEmojis } : { ...menu.buttonEmojis };

        chunkRoles.forEach((roleId, i) => {
          const val = interaction.fields.getTextInputValue(`emoji_${i}`);
          if (val && val.trim()) emojis[roleId] = val.trim();
        });

        // Save updated emojis
        db.saveEmojis(menuId, emojis, type);

        // Update index for next batch
        menu._emojiIndex[type] = startIndex + 5;

        if (menu._emojiIndex[type] < roles.length) {
          // More emojis to set: show modal again for next batch
          return interaction.reply({
            content: `✅ Emojis saved for roles ${startIndex + 1} to ${menu._emojiIndex[type]}. Showing next roles...`,
            ephemeral: true,
          }).then(() => {
            // Show next modal with next batch
            const nextChunkRoles = roles.slice(menu._emojiIndex[type], menu._emojiIndex[type] + 5);
            const modal = new ModalBuilder()
              .setCustomId(`rr:modal:addemojis:${type}:${menuId}`)
              .setTitle(`Add Emojis for ${type} Roles`);

            nextChunkRoles.forEach((roleId, i) => {
              const role = interaction.guild.roles.cache.get(roleId);
              modal.addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId(`emoji_${i}`)
                    .setLabel(`Emoji for: ${role?.name || "Unknown Role"}`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Enter emoji (unicode or custom)")
                    .setRequired(false)
                )
              );
            });

            return interaction.showModal(modal);
          });
        } else {
          // Finished setting emojis, reset index
          menu._emojiIndex[type] = 0;
          return interaction.reply({ content: "✅ All emojis saved.", ephemeral: true });
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("rr:selectroles:")) {
        // Role selection for dropdown or button
        const [, , type, menuId] = interaction.customId.split(":");
        if (!interaction.values.length) return interaction.reply({ content: "❌ No roles selected.", ephemeral: true });

        db.saveRoles(menuId, interaction.values, type);

        // Next selection type?
        const menu = db.getMenu(menuId);
        const selectionType = menu.selectionType;

        let stillNeeds = null;
        if (selectionType.includes("dropdown") && !menu.dropdownRoles.length) stillNeeds = "dropdown";
        else if (selectionType.includes("button") && !menu.buttonRoles.length) stillNeeds = "button";

        if (stillNeeds) {
          const allRoles = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${stillNeeds}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map(r => ({ label: r.name, value: r.id })));

          return interaction.update({
            content: `✅ Saved roles for **${type}**. Now select roles for **${stillNeeds}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        } else {
          // All role selections done, show next step buttons: set limits, exclusions, add emojis, publish
          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`rr:setlimits::${menuId}`)
              .setLabel("Set Limits")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`rr:setexclusions::${menuId}`)
              .setLabel("Set Exclusions")
              .setStyle(ButtonStyle.Secondary)
          );

          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`rr:addemojis:dropdown:${menuId}`)
              .setLabel("Add Dropdown Emojis")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`rr:addemojis:button:${menuId}`)
              .setLabel("Add Button Emojis")
              .setStyle(ButtonStyle.Primary)
          );

          const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`rr:publish::${menuId}`)
              .setLabel("Publish Menu")
              .setStyle(ButtonStyle.Success)
          );

          return interaction.update({
            content: `✅ All roles saved. Now you can set limits, exclusions, add emojis, or publish the menu.`,
            components: [row1, row2, row3],
          });
        }
      }
    }

    if (interaction.isSelectMenu()) {
      // Role selection menu on published messages
      const [ctx, menuId] = interaction.customId.split(":");
      if (ctx === "rrmenu") {
        // This is the dropdown role selection interaction
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu data not found.", ephemeral: true });

        const member = interaction.member;
        if (!member) return interaction.reply({ content: "Member not found.", ephemeral: true });

        // Apply role limit
        const limit = menu.limits.dropdown || 0;
        if (limit > 0 && interaction.values.length > limit) {
          return interaction.reply({ content: `You can select up to ${limit} roles only.`, ephemeral: true });
        }

        // Assign and remove roles based on selection
        const newRoles = interaction.values;
        const oldRoles = menu.dropdownRoles.filter(rId => member.roles.cache.has(rId));

        // Add roles selected that member doesn't have
        for (const roleId of newRoles) {
          if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId).catch(() => {});
          }
        }

        // Remove roles deselected
        for (const roleId of oldRoles) {
          if (!newRoles.includes(roleId)) {
            await member.roles.remove(roleId).catch(() => {});
          }
        }

        // Apply exclusions (remove conflicting roles)
        await applyExclusions(member, menu, newRoles);

        return interaction.reply({ content: "Roles updated!", ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      // Button role selection interaction
      const [ctx, action, menuId, roleId] = interaction.customId.split(":");
      if (ctx === "rrbtn" && action === "toggle") {
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.reply({ content: "Menu data not found.", ephemeral: true });
        const member = interaction.member;
        if (!member) return interaction.reply({ content: "Member not found.", ephemeral: true });

        // Check role limit for button roles
        const limit = menu.limits.button || 0;
        const currentRoles = menu.buttonRoles.filter(rId => member.roles.cache.has(rId));
        const hasRole = member.roles.cache.has(roleId);

        if (!hasRole && limit > 0 && currentRoles.length >= limit) {
          return interaction.reply({ content: `You can select up to ${limit} button roles only.`, ephemeral: true });
        }

        if (hasRole) {
          await member.roles.remove(roleId).catch(() => {});
        } else {
          await member.roles.add(roleId).catch(() => {});
        }

        // After change, apply exclusions for buttons roles
        const newRoles = hasRole ? currentRoles.filter(r => r !== roleId) : [...currentRoles, roleId];
        await applyExclusions(member, menu, newRoles);

        return interaction.reply({ content: `Role ${hasRole ? "removed" : "added"}!`, ephemeral: true });
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: "An error occurred.", ephemeral: true }).catch(() => {});
    } else {
      interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(() => {});
    }
  }
});

async function sendMainDashboard(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("Server Dashboard")
    .setDescription("Manage reaction role menus and more.")
    .setColor("Blue");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dash:reaction-roles")
      .setLabel("Reaction Roles")
      .setStyle(ButtonStyle.Primary)
  );

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
  } else {
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
}

async function showReactionRolesDashboard(interaction) {
  const guildId = interaction.guild.id;
  const menus = db.getMenus(guildId);

  const embed = new EmbedBuilder()
    .setTitle("Reaction Role Menus")
    .setDescription(menus.length ? menus.map(m => `• **${m.name}** - ID: \`${m.id}\``).join("\n") : "No menus found.")
    .setColor("Green");

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rr:create")
      .setLabel("Create New Menu")
      .setStyle(ButtonStyle.Success)
  );

  // Buttons for existing menus for editing/publishing
  const rows = [row1];
  menus.forEach(menu => {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rr:type:dropdown:${menu.id}`)
          .setLabel(`Edit Dropdown Roles (${menu.dropdownRoles.length})`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rr:type:button:${menu.id}`)
          .setLabel(`Edit Button Roles (${menu.buttonRoles.length})`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rr:publish::${menu.id}`)
          .setLabel("Publish Menu")
          .setStyle(ButtonStyle.Success)
      )
    );
  });

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ embeds: [embed], components: rows, ephemeral: true });
  } else {
    return interaction.update({ embeds: [embed], components: rows });
  }
}

async function publishMenu(interaction, menuId) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.reply({ content: "Menu not found.", ephemeral: true });

  if (!menu.selectionType.length) return interaction.reply({ content: "Selection type not set.", ephemeral: true });

  if (!menu.channelId) menu.channelId = interaction.channel.id;

  const channel = interaction.guild.channels.cache.get(menu.channelId) || interaction.channel;

  // Compose embed for menu
  const embed = new EmbedBuilder()
    .setTitle(menu.name)
    .setDescription(menu.desc)
    .setColor("Blue");

  const components = [];

  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length) {
    // Dropdown component
    const options = menu.dropdownRoles.map(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return null;
      let emoji = menu.dropdownEmojis[roleId];
      if (emoji) {
        emoji = parseEmojiString(emoji);
      }
      return {
        label: role.name,
        value: role.id,
        emoji: emoji,
      };
    }).filter(Boolean);

    const select = new StringSelectMenuBuilder()
      .setCustomId(`rrmenu:${menuId}`)
      .setMinValues(0)
      .setMaxValues(menu.limits.dropdown > 0 ? menu.limits.dropdown : options.length)
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(select));
  }

  if (menu.selectionType.includes("button") && menu.buttonRoles.length) {
    // Buttons component
    const buttons = menu.buttonRoles.map(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return null;
      let emoji = menu.buttonEmojis[roleId];
      if (emoji) {
        emoji = parseEmojiString(emoji);
      }
      return new ButtonBuilder()
        .setCustomId(`rrbtn:toggle:${menuId}:${roleId}`)
        .setLabel(role.name)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emoji || null);
    }).filter(Boolean);

    // Buttons max 5 per row, split if needed
    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  }

  // Send or edit existing message
  try {
    let msg;
    if (menu.messageId) {
      const oldMsg = await channel.messages.fetch(menu.messageId).catch(() => null);
      if (oldMsg) {
        msg = await oldMsg.edit({ embeds: [embed], components });
      } else {
        msg = await channel.send({ embeds: [embed], components });
        db.saveMessageId(menuId, channel.id, msg.id);
      }
    } else {
      msg = await channel.send({ embeds: [embed], components });
      db.saveMessageId(menuId, channel.id, msg.id);
    }

    return interaction.reply({ content: "✅ Menu published!", ephemeral: true });
  } catch (error) {
    console.error("Publish error:", error);
    return interaction.reply({ content: "Failed to publish menu. Check bot permissions and channel.", ephemeral: true });
  }
}

client.login(process.env.TOKEN);
