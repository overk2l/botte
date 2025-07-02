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
  PermissionsBitField,
} = require("discord.js");

// Firebase Imports
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, getDocs } = require('firebase/firestore');

// Initialize Firebase (using environment variables)
const appId = process.env.APP_ID || 'default-app-id';
let firebaseConfig = {};
try {
  if (process.env.FIREBASE_CONFIG) {
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  } else {
    console.warn("[Firebase Init Warning] FIREBASE_CONFIG environment variable is not set. Using dummy projectId.");
  }
} catch (e) {
  console.error("[Firebase Init Error] Could not parse FIREBASE_CONFIG:", e);
  firebaseConfig = {}; // Fallback to an empty config if parsing fails
}

if (!firebaseConfig.projectId) {
  console.error("[Firebase Init Error] 'projectId' is missing from firebaseConfig. Please ensure FIREBASE_CONFIG is correctly provided by the environment.");
  firebaseConfig.projectId = 'missing-project-id';
}

const firebaseApp = initializeApp(firebaseConfig);
const dbFirestore = getFirestore(firebaseApp);

// Webhook management helper
async function getOrCreateWebhook(channel, name = "Role Menu Webhook") {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find(w => w.owner.id === channel.client.user.id);

  if (existing) return existing;
  return channel.createWebhook({
    name,
    avatar: channel.client.user.displayAvatarURL(),
    reason: "For role menus with custom branding"
  });
}

const db = { // This in-memory map will now be synchronized with Firestore
  menus: new Map(), // Stores guildId -> [menuId, ...]
  menuData: new Map(), // Stores menuId -> menuObject

  async loadAllMenus() {
    console.log("[Firestore] Loading all menus...");
    if (firebaseConfig.projectId === 'missing-project-id') {
      console.warn("[Firestore] Skipping menu loading: projectId is missing or invalid. Please configure Firebase.");
      return;
    }
    try {
      const menusCollectionRef = collection(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`);
      const querySnapshot = await getDocs(menusCollectionRef);
      this.menus.clear();
      this.menuData.clear();

      querySnapshot.forEach(doc => {
        const menu = doc.data();
        const menuId = doc.id;
        const guildId = menu.guildId;

        if (!this.menus.has(guildId)) {
          this.menus.set(guildId, []);
        }
        this.menus.get(guildId).push(menuId);
        this.menuData.set(menuId, menu);
      });
      console.log(`[Firestore] Loaded ${this.menuData.size} menus.`);
    } catch (error) {
      console.error("[Firestore] Error loading menus:", error);
    }
  },

  async createMenu(guildId, name, desc) {
    const id = Date.now().toString() + Math.floor(Math.random() * 1000).toString();
    const newMenu = {
      guildId,
      name,
      desc,
      dropdownRoles: [],
      buttonRoles: [],
      selectionType: [],
      dropdownEmojis: {},
      buttonEmojis: {},
      regionalLimits: {},
      exclusionMap: {},
      maxRolesLimit: null,
      successMessageAdd: "✅ You now have the role <@&{roleId}>!",
      successMessageRemove: "✅ You removed the role <@&{roleId}>!",
      limitExceededMessage: "❌ You have reached the maximum number of roles for this menu or region.",
      dropdownRoleOrder: [],
      buttonRoleOrder: [],
      dropdownRoleDescriptions: {},
      channelId: null,
      messageId: null,
      enableDropdownClearRolesButton: true,
      enableButtonClearRolesButton: true,
      useWebhook: false,
      webhookName: null,
      webhookAvatar: null,
      embedColor: null,
      embedThumbnail: null,
      embedImage: null,
      embedAuthorName: null,
      embedAuthorIconURL: null,
      embedFooterText: null,
      embedFooterIconURL: null,
    };

    if (firebaseConfig.projectId === 'missing-project-id') {
      console.warn("[Firestore] Skipping menu creation: projectId is missing or invalid. Please configure Firebase.");
      if (!this.menus.has(guildId)) {
        this.menus.set(guildId, []);
      }
      this.menus.get(guildId).push(id);
      this.menuData.set(id, newMenu);
      return id;
    }

    try {
      const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, id);
      await setDoc(menuDocRef, newMenu);

      if (!this.menus.has(guildId)) {
        this.menus.set(guildId, []);
      }
      this.menus.get(guildId).push(id);
      this.menuData.set(id, newMenu);
      console.log(`[Firestore] Created new menu with ID: ${id}`);
      return id;
    } catch (error) {
      console.error("[Firestore] Error creating menu:", error);
      throw new Error("Failed to create menu in Firestore. Check permissions.");
    }
  },

  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map((id) => ({ id, ...this.menuData.get(id) }));
  },

  async updateMenu(menuId, data) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    Object.assign(menu, data); // Update in-memory

    if (firebaseConfig.projectId === 'missing-project-id') {
      console.warn("[Firestore] Skipping menu update: projectId is missing or invalid. Data will not persist.");
      return;
    }

    try {
      const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, menuId);
      await setDoc(menuDocRef, menu); // Update Firestore
      console.log(`[Firestore] Updated menu with ID: ${menuId}`);
    } catch (error) {
      console.error(`[Firestore] Error updating menu ${menuId}:`, error);
      throw new Error("Failed to update menu in Firestore. Check permissions.");
    }
  },

  async saveRoles(menuId, roles, type) {
    const updateData = {};
    if (type === "dropdown") updateData.dropdownRoles = roles;
    if (type === "button") updateData.buttonRoles = roles;
    await this.updateMenu(menuId, updateData);
  },
  async saveSelectionType(menuId, types) {
    await this.updateMenu(menuId, { selectionType: types });
  },
  async saveEmojis(menuId, emojis, type) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    const currentEmojis = menu[type === "dropdown" ? "dropdownEmojis" : "buttonEmojis"];
    const updatedEmojis = { ...currentEmojis, ...emojis };
    const updateData = {};
    if (type === "dropdown") updateData.dropdownEmojis = updatedEmojis;
    if (type === "button") updateData.buttonEmojis = updatedEmojis;
    await this.updateMenu(menuId, updateData);
  },
  async saveRegionalLimits(menuId, regionalLimits) {
    await this.updateMenu(menuId, { regionalLimits });
  },
  async saveExclusionMap(menuId, exclusionMap) {
    await this.updateMenu(menuId, { exclusionMap });
  },
  async saveMaxRolesLimit(menuId, limit) {
    await this.updateMenu(menuId, { maxRolesLimit: limit });
  },
  async saveCustomMessages(menuId, messages) {
    await this.updateMenu(menuId, messages);
  },
  async saveRoleOrder(menuId, order, type) {
    const updateData = {};
    if (type === "dropdown") updateData.dropdownRoleOrder = order;
    if (type === "button") updateData.buttonRoleOrder = order;
    await this.updateMenu(menuId, updateData);
  },
  async saveRoleDescriptions(menuId, descriptions) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    const updatedDescriptions = { ...menu.dropdownRoleDescriptions, ...descriptions };
    await this.updateMenu(menuId, { dropdownRoleDescriptions: updatedDescriptions });
  },
  async saveEmbedCustomization(menuId, embedSettings) {
    await this.updateMenu(menuId, embedSettings);
  },
  async saveEnableDropdownClearRolesButton(menuId, enabled) {
    await this.updateMenu(menuId, { enableDropdownClearRolesButton: enabled });
  },
  async saveEnableButtonClearRolesButton(menuId, enabled) {
    await this.updateMenu(menuId, { enableButtonClearRolesButton: enabled });
  },
  getMenu(menuId) {
    return this.menuData.get(menuId);
  },
  async saveMessageId(menuId, channelId, messageId) {
    await this.updateMenu(menuId, { channelId, messageId });
  },
  async clearMessageId(menuId) {
    await this.updateMenu(menuId, { channelId: null, messageId: null });
  },
  async saveWebhookSettings(menuId, settings) {
    await this.updateMenu(menuId, settings);
  },
  async deleteMenu(menuId) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;

    // Remove from in-memory maps
    const guildMenus = this.menus.get(menu.guildId);
    if (guildMenus) {
      const index = guildMenus.indexOf(menuId);
      if (index > -1) {
        guildMenus.splice(index, 1);
      }
    }
    this.menuData.delete(menuId);

    if (firebaseConfig.projectId === 'missing-project-id') {
      console.warn("[Firestore] Skipping menu deletion: projectId is missing or invalid. Data will not persist.");
      return;
    }

    try {
      // Delete from Firestore
      const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, menuId);
      await deleteDoc(menuDocRef);
      console.log(`[Firestore] Deleted menu with ID: ${menuId}`);
    } catch (error) {
      console.error(`[Firestore] Error deleting menu ${menuId}:`, error);
      throw new Error("Failed to delete menu from Firestore. Check permissions.");
    }
  },
  // New functions for db object (if they were missing)
  async saveExclusionRoles(menuId, triggerRoleId, exclusionRoleIds) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    const updatedExclusionMap = { ...menu.exclusionMap, [triggerRoleId]: exclusionRoleIds };
    await this.updateMenu(menuId, { exclusionMap: updatedExclusionMap });
  },
  async saveLimits(menuId, regionalLimits, maxRolesLimit) {
    await this.updateMenu(menuId, { regionalLimits, maxRolesLimit });
  },
  async saveEmbedCustomizations(menuId, embedSettings) { // Consolidate embed settings saving
    await this.updateMenu(menuId, embedSettings);
  }
};

// Helper function to parse emoji strings for Discord components
function parseEmoji(emoji) {
  if (!emoji) return null;

  const customEmojiRegex = /^<a?:([a-zA-Z0-9_]+):(\d+)>$/;
  const match = emoji.match(customEmojiRegex);

  if (match) {
    return {
      id: match[2],
      name: match[1],
      animated: emoji.startsWith("<a:"),
    };
  }
  // Validate if it's a single unicode emoji
  const unicodeEmojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
  if (emoji.match(unicodeEmojiRegex)) {
    return { name: emoji };
  }

  console.warn(`Invalid emoji format detected: "${emoji}". Returning null.`);
  return null;
}

// Helper function to check regional limits
function checkRegionalLimits(member, menu, newRoleIds) {
  const memberRoles = member.roles.cache;
  const violations = [];

  for (const [regionName, regionData] of Object.entries(menu.regionalLimits || {})) {
    const { limit, roleIds } = regionData;
    if (!limit || !roleIds || !roleIds.length) continue;

    const newRegionRoles = roleIds.filter(roleId => newRoleIds.includes(roleId));

    if (newRegionRoles.length > limit) {
      violations.push(`You can only select ${limit} role(s) from the ${regionName} region.`);
    }
  }

  return violations;
}

// Helper function to create the reaction role embed (used by publish and update)
async function createReactionRoleEmbed(guild, menu) {
    const embed = new EmbedBuilder()
        .setTitle(menu.name)
        .setDescription(menu.desc)
        .setColor(menu.embedColor || "#5865F2");

    if (menu.embedThumbnail) embed.setThumbnail(menu.embedThumbnail);
    if (menu.embedImage) embed.setImage(menu.embedImage);
    if (menu.embedAuthorName) {
        embed.setAuthor({
            name: menu.embedAuthorName,
            iconURL: menu.embedAuthorIconURL || undefined
        });
    }
    if (menu.embedFooterText) {
        embed.setFooter({
            text: menu.embedFooterText,
            iconURL: menu.embedFooterIconURL || undefined
        });
    }
    return embed;
}

// Helper to update the components on the published message
async function updatePublishedMessageComponents(interaction, menu) {
    if (!menu.channelId || !menu.messageId) return;

    const guild = interaction.guild;
    const member = interaction.member; // The member who triggered the interaction

    try {
        const originalChannel = await guild.channels.fetch(menu.channelId);
        const originalMessage = await originalChannel.messages.fetch(menu.messageId);

        const components = [];

        // Rebuild Dropdown Select Menu
        if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length > 0) {
            const currentDropdownRolesHeldByMember = (menu.dropdownRoles || []).filter(id => member.roles.cache.has(id));
            const dropdownOptions = (menu.dropdownRoleOrder.length > 0
                ? menu.dropdownRoleOrder
                : menu.dropdownRoles
            ).map(roleId => {
                const role = guild.roles.cache.get(roleId);
                if (!role) return null;
                const isSelected = currentDropdownRolesHeldByMember.includes(roleId);
                return {
                    label: role.name,
                    value: role.id,
                    emoji: parseEmoji(menu.dropdownEmojis[role.id]) || undefined,
                    description: menu.dropdownRoleDescriptions[role.id] || undefined,
                    default: isSelected // Set default based on current roles
                };
            }).filter(Boolean);

            if (dropdownOptions.length > 0) {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`rr-role-select:${menu.id}`)
                    .setPlaceholder("Select your roles...")
                    .setMinValues(0)
                    .setMaxValues(dropdownOptions.length)
                    .addOptions(dropdownOptions);
                components.push(new ActionRowBuilder().addComponents(selectMenu));
            }
        }

        // Rebuild Clear dropdown roles button
        if (menu.selectionType.includes("dropdown") && menu.enableDropdownClearRolesButton) {
            const clearButton = new ButtonBuilder()
                .setCustomId(`rr-clear-roles:${menu.id}:dropdown`)
                .setLabel("Clear All Dropdown Roles")
                .setStyle(ButtonStyle.Secondary);
            components.push(new ActionRowBuilder().addComponents(clearButton));
        }

        // Rebuild Buttons (no default state for buttons, they are stateless)
        if (menu.selectionType.includes("button") && menu.buttonRoles.length > 0) {
            const buttonRows = [];
            let currentRow = new ActionRowBuilder();
            const orderedButtonRoles = menu.buttonRoleOrder.length > 0
                ? menu.buttonRoleOrder
                : menu.buttonRoles;

            for (const roleId of orderedButtonRoles) {
                const role = guild.roles.cache.get(roleId);
                if (!role) continue;

                const button = new ButtonBuilder()
                    .setCustomId(`rr-role-button:${menu.id}:${role.id}`)
                    .setLabel(role.name)
                    .setStyle(member.roles.cache.has(roleId) ? ButtonStyle.Success : ButtonStyle.Secondary) // Highlight if member has role
                    .setEmoji(parseEmoji(menu.buttonEmojis[role.id]));

                if (currentRow.components.length < 5) {
                    currentRow.addComponents(button);
                } else {
                    buttonRows.push(currentRow);
                    currentRow = new ActionRowBuilder().addComponents(button);
                }
            }
            if (currentRow.components.length > 0) {
                buttonRows.push(currentRow);
            }
            components.push(...buttonRows);
        }

        // Rebuild Clear button roles button
        if (menu.selectionType.includes("button") && menu.enableButtonClearRolesButton) {
            const clearButton = new ButtonBuilder()
                .setCustomId(`rr-clear-roles:${menu.id}:button`)
                .setLabel("Clear All Button Roles")
                .setStyle(ButtonStyle.Secondary);
            components.push(new ActionRowBuilder().addComponents(clearButton));
        }

        const publishedEmbed = await createReactionRoleEmbed(guild, menu);

        // Edit the message
        if (menu.useWebhook) {
            const webhook = await getOrCreateWebhook(originalChannel);
            await webhook.editMessage(originalMessage.id, {
                embeds: [publishedEmbed],
                components,
                username: menu.webhookName || guild.me.displayName,
                avatarURL: menu.webhookAvatar || guild.me.displayAvatarURL(),
            });
        } else {
            await originalMessage.edit({ embeds: [publishedEmbed], components });
        }

    } catch (error) {
        console.error("Error updating published message components:", error);
    }
}

// Helper function to handle role assignment/removal for users
async function handleRoleAssignment(interaction, menuId, roleIdsInput, isButtonClear = false, isSelectMenu = false) {
    const menu = db.getMenu(menuId);
    if (!menu) return interaction.editReply({ content: "❌ This reaction role menu is no longer valid.", ephemeral: true });

    const member = interaction.member;
    const guild = interaction.guild;

    let rolesToAdd = [];
    let rolesToRemove = [];
    let messages = [];

    // If it's a clear button, remove all roles associated with this menu
    if (isButtonClear) {
        const allMenuRoleIds = [...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])];
        rolesToRemove = member.roles.cache.filter(role => allMenuRoleIds.includes(role.id)).map(role => role.id);
        if (rolesToRemove.length === 0) {
            return interaction.editReply({ content: "You don't have any roles from this menu to clear.", ephemeral: true });
        }
    } else {
        // For regular role assignment (button or select menu)
        const selectedRoleIds = Array.isArray(roleIdsInput) ? roleIdsInput : [roleIdsInput];

        // Get all roles currently held by the member that are part of THIS menu
        const currentMenuRoleIdsHeldByMember = [
            ...(menu.dropdownRoles || []),
            ...(menu.buttonRoles || []),
        ].filter(id => member.roles.cache.has(id));

        // Determine roles to add and remove based on selection
        rolesToAdd = selectedRoleIds.filter(id => !member.roles.cache.has(id));
        rolesToRemove = currentMenuRoleIdsHeldByMember.filter(id => !selectedRoleIds.includes(id));

        // Combined list of roles after this interaction (for limit checks)
        let potentialNewRoleIds = currentMenuRoleIdsHeldByMember
            .filter(id => !rolesToRemove.includes(id)) // Remove roles being unselected
            .concat(rolesToAdd); // Add roles being selected

        // Filter out duplicates if any
        potentialNewRoleIds = [...new Set(potentialNewRoleIds)];

        // Handle exclusions first (roles to remove due to a selected role)
        let rolesToRemoveByExclusion = [];
        for (const selectedRoleId of rolesToAdd) { // Only check exclusions for roles being newly added
            if (menu.exclusionMap && menu.exclusionMap[selectedRoleId]) {
                const excludedRoles = menu.exclusionMap[selectedRoleId].filter(id => member.roles.cache.has(id));
                if (excludedRoles.length > 0) {
                    rolesToRemoveByExclusion.push(...excludedRoles);
                    const removedRoleNames = excludedRoles.map(id => guild.roles.cache.get(id)?.name || 'Unknown Role').join(', ');
                    messages.push(`Removed conflicting roles: ${removedRoleNames}`);
                }
            }
        }
        rolesToRemove.push(...rolesToRemoveByExclusion);
        rolesToRemove = [...new Set(rolesToRemove)]; // Ensure no duplicates in rolesToRemove

        // Re-evaluate potentialNewRoleIds after exclusions
        potentialNewRoleIds = potentialNewRoleIds.filter(id => !rolesToRemove.includes(id));


        // Check regional limits
        const regionalViolations = checkRegionalLimits(member, menu, potentialNewRoleIds);
        if (regionalViolations.length > 0) {
            await interaction.editReply({ content: menu.limitExceededMessage || `❌ ${regionalViolations.join("\n")}`, ephemeral: true });
            // If it was a select menu, re-sync its state
            if (isSelectMenu) {
                await updatePublishedMessageComponents(interaction, menu);
            }
            return;
        }

        // Check overall max roles limit
        if (menu.maxRolesLimit !== null && menu.maxRolesLimit > 0) {
            if (potentialNewRoleIds.length > menu.maxRolesLimit) {
                await interaction.editReply({ content: menu.limitExceededMessage || `❌ You can only have a maximum of ${menu.maxRolesLimit} roles from this menu.`, ephemeral: true });
                // If it was a select menu, re-sync its state
                if (isSelectMenu) {
                    await updatePublishedMessageComponents(interaction, menu);
                }
                return;
            }
        }

        // Prepare success/remove messages for roles based on final add/remove lists
        rolesToAdd.forEach(id => {
            messages.push((menu.successMessageAdd || "✅ You now have the role <@&{roleId}>!").replace("{roleId}", id));
        });
        rolesToRemove.forEach(id => {
            // Only add message if it's not a role that was just added and then removed by exclusion
            if (!selectedRoleIds.includes(id) || rolesToRemoveByExclusion.includes(id)) {
                messages.push((menu.successMessageRemove || "✅ You removed the role <@&{roleId}>!").replace("{roleId}", id));
            }
        });
    } // End of isButtonClear else block

    try {
        if (rolesToAdd.length > 0) {
            await member.roles.add(rolesToAdd);
        }
        if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove);
        }

        if (messages.length > 0) {
            await interaction.editReply({ content: messages.join("\n"), ephemeral: true });
        } else {
            await interaction.editReply({ content: "No changes made to your roles.", ephemeral: true });
        }

        // Update the original published message components to reflect current selections
        await updatePublishedMessageComponents(interaction, menu);

    } catch (error) {
        console.error("Error managing roles:", error);
        if (error.code === 50013) {
            await interaction.editReply({ content: "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.", ephemeral: true });
        } else {
            await interaction.editReply({ content: "❌ An error occurred while updating your roles.", ephemeral: true });
        }
    }
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildWebhooks,
  ],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // Load all menus from Firestore when the bot starts
  await db.loadAllMenus();

  const rest = new REST().setToken(process.env.TOKEN);
  const cmd = new SlashCommandBuilder().setName("dashboard").setDescription("Open the guild dashboard").toJSON();
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
  console.log(" /dashboard command deployed");
});

client.on("interactionCreate", async (interaction) => {
  // IMPORTANT: Deferral logic moved to allow showModal to work without conflicting with deferReply
  // We only defer if it's NOT a modal submission that needs an immediate showModal call
  const isCreateModal = interaction.isButton() && interaction.customId === "rr:create";
  const isAddEmojiModal = interaction.isButton() && interaction.customId.startsWith("rr:addemoji:");
  const isSetLimitsModal = interaction.isButton() && interaction.customId.startsWith("rr:setlimits:");
  const isCustomizeEmbedModal = interaction.isButton() && interaction.customId.startsWith("rr:customize_embed:");
  const isCustomizeFooterModal = interaction.isButton() && interaction.customId.startsWith("rr:customize_footer:");
  const isWebhookBrandingModal = interaction.isButton() && interaction.customId.startsWith("rr:config_webhook:");


  // Only defer if it's not one of the specific interactions that immediately show a modal
  if (!interaction.replied && !interaction.deferred &&
    (interaction.isChatInputCommand() ||
      (interaction.isButton() && !(isCreateModal || isAddEmojiModal || isSetLimitsModal || isCustomizeEmbedModal || isCustomizeFooterModal || isWebhookBrandingModal)) ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit()
    )) {
    await interaction.deferReply({ ephemeral: true }).catch(e => console.error("Error deferring reply:", e));
  }


  // Check Firebase configuration at the start of every interaction
  if (firebaseConfig.projectId === 'missing-project-id') {
    // Use followUp since the interaction is now deferred (or was intended to be deferred)
    // For modals, this will be followUp after the modal submit. For other interactions, after initial defer.
    await interaction.followUp({
      content: "⚠️ **Warning: Firebase is not fully configured.** Your bot's data (menus, roles, etc.) will not be saved or loaded persistently. Please ensure `__firebase_config` in your Canvas environment provides a valid `projectId`.",
      ephemeral: true
    }).catch(e => console.error("Error sending Firebase config warning:", e));
    // If Firebase is not configured, we might want to stop further processing for persistence-related commands
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
      return; // Stop processing dashboard if Firebase isn't ready
    }
    if (interaction.isButton() && interaction.customId.startsWith("rr:")) {
      return; // Stop processing RR buttons if Firebase isn't ready
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("rr:modal:")) {
      return; // Stop processing RR modals if Firebase isn't ready
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:")) {
      return; // Stop processing RR selects if Firebase isn't ready
    }
  }


  try {
    // Slash Command Handling
    if (interaction.isChatInputCommand()) {
      // 1. Dashboard Permissions Check for the /dashboard command
      if (interaction.commandName === "dashboard") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.editReply({ content: "❌ You need Administrator permissions to use the dashboard.", ephemeral: true });
        }
        return sendMainDashboard(interaction);
      }
    }


    // Button Handling
    if (interaction.isButton()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];

      // Declare variables for menuId, type, newState at the top of the rr context
      let menuId;
      let type;
      let newStateBoolean; // For toggle buttons

      if (ctx === "dash") {
        if (action === "reaction-roles") return showReactionRolesDashboard(interaction);
        if (action === "back") return sendMainDashboard(interaction);
      }

      if (ctx === "rr") {
        // All dashboard-related buttons should also have a permission check
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.editReply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        // Assign menuId, type, newState based on action within the rr context
        if (action === "create") {
          // No menuId needed yet, it's created in the modal submit
        } else if (["publish", "edit_published", "delete_published", "confirm_delete_published", "cancel_delete_published", "setlimits", "setexclusions", "customize_embed", "customize_footer", "toggle_webhook", "config_webhook"].includes(action)) {
          menuId = parts[2]; // For these actions, menuId is parts[2]
        } else if (["type", "addemoji"].includes(action)) {
          type = parts[2]; // 'dropdown', 'button', 'both' for type; 'dropdown', 'button' for addemoji
          menuId = parts[3]; // For these actions, menuId is parts[3]
        } else if (["toggle_dropdown_clear_button", "toggle_button_clear_button"].includes(action)) {
          menuId = parts[2];
          newStateBoolean = parts[3] === 'true';
        }


        if (action === "create") {
          const modal = new ModalBuilder()
            .setCustomId("rr:modal:create")
            .setTitle("New Reaction Role Menu")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("name").setLabel("Menu Name").setStyle(TextInputStyle.Short).setRequired(true)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("desc").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(true)
              )
            );
          return interaction.showModal(modal); // showModal here
        }

        if (action === "publish") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing for publish.", ephemeral: true });
          return publishMenu(interaction, menuId);
        }

        if (action === "edit_published") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return interaction.editReply({ content: "❌ No published message found for this menu to edit.", ephemeral: true });
          }
          const channel = interaction.guild.channels.cache.get(menu.channelId);
          if (!channel) return interaction.editReply({ content: "❌ Published channel not found.", ephemeral: true });

          try {
            const message = await channel.messages.fetch(menu.messageId);
            return publishMenu(interaction, menuId, message);
          } catch (error) {
            console.error("Error fetching message to edit:", error);
            return interaction.editReply({ content: "❌ Failed to fetch published message. It might have been deleted manually.", ephemeral: true });
          }
        }

        if (action === "delete_published") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return interaction.editReply({ content: "❌ No published message found for this menu to delete.", ephemeral: true });
          }

          const confirmButton = new ButtonBuilder()
            .setCustomId(`rr:confirm_delete_published:${menuId}`)
            .setLabel("Confirm Delete")
            .setStyle(ButtonStyle.Danger);
          const cancelButton = new ButtonBuilder()
            .setCustomId(`rr:cancel_delete_published:${menuId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary);
          const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

          return interaction.editReply({
            content: "⚠️ Are you sure you want to delete the published reaction role message? This cannot be undone.",
            components: [row],
            ephemeral: true
          });
        }

        if (action === "confirm_delete_published") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return interaction.editReply({ content: "❌ No published message found or already deleted.", components: [], ephemeral: true });
          }
          const channel = interaction.guild.channels.cache.get(menu.channelId);
          if (!channel) {
            await db.clearMessageId(menuId);
            return interaction.editReply({ content: "❌ Published channel not found. Message ID cleared.", components: [], ephemeral: true });
          }

          try {
            const message = await channel.messages.fetch(menu.messageId);
            await message.delete();
            // Only clear message ID, don't delete the entire menu from Firestore
            await db.clearMessageId(menuId);
            await interaction.editReply({
              content: "✅ Published message deleted successfully!",
              components: [],
              ephemeral: true
            });
            return showMenuConfiguration(interaction, menuId);
          } catch (error) {
            console.error("Error deleting message:", error);
            await db.clearMessageId(menuId);
            return interaction.editReply({
              content: "❌ Failed to delete message. It might have already been deleted manually. Message ID cleared.",
              ephemeral: true
            });
          }
        }

        if (action === "cancel_delete_published") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], ephemeral: true });
          return interaction.editReply({ content: "Deletion cancelled.", components: [], ephemeral: true });
        }

        if (action === "type") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing for selection type.", ephemeral: true });
          let selectedTypes = type === "both" ? ["dropdown", "button"] : [type];
          await db.saveSelectionType(menuId, selectedTypes);

          const nextType = selectedTypes.includes("dropdown") ? "dropdown" : "button";
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${nextType}:${menuId}`)
            .setMinValues(1)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.editReply({
            content: `✅ Selection type saved. Now select roles for **${nextType}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
          });
        }

        if (action === "addemoji") {
          if (!menuId || !type) return interaction.editReply({ content: "Menu ID or type missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder().setCustomId(`rr:modal:addemoji:${type}:${menuId}`).setTitle(`Add Emojis for ${type}`);

          const roles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []); // Ensure roles is an array
          const maxInputs = Math.min(roles.length, 5); // Discord modal limit
          for (let i = 0; i < maxInputs; i++) {
            const roleId = roles[i];
            const role = interaction.guild.roles.cache.get(roleId);
            const currentEmoji = type === "dropdown" ? (menu.dropdownEmojis?.[roleId] || "") : (menu.buttonEmojis?.[roleId] || "");
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(roleId)
                  .setLabel(`Emoji for ${role ? role.name : "Unknown Role"}`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("Enter emoji (🔥 or <:name:id>)")
                  .setValue(currentEmoji)
              )
            );
          }
          // If no roles, display a warning instead of an empty modal
          if (roles.length === 0) {
            return interaction.editReply({ content: `No roles configured for ${type} menu. Add roles first.`, ephemeral: true });
          }
          return interaction.showModal(modal); // showModal does not conflict with deferred reply
        }

        if (action === "setlimits") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setlimits:${menuId}`)
            .setTitle("Set Regional Role Limits & Max Roles")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("au_limit")
                  .setLabel("Limit For AU Roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits?.AU?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("eu_limit")
                  .setLabel("Limit For EU Roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits?.EU?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("na_limit")
                  .setLabel("Limit For NA Roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits?.NA?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("regional_role_assignments")
                  .setLabel("Regional Role Assignments (JSON)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('{"AU": ["roleId1"], "EU": ["roleId2"], "NA": ["roleId3"]}')
                  .setRequired(false)
                  .setValue(JSON.stringify(Object.fromEntries(
                    Object.entries(menu.regionalLimits || {}).map(([region, data]) => [region, data.roleIds || []])
                  )) || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("max_roles_limit")
                  .setLabel("Max Roles Per Menu (0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("0")
                  .setValue(menu.maxRolesLimit !== null && menu.maxRolesLimit !== undefined ? menu.maxRolesLimit.toString() : "")
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "setexclusions") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          if (!allRoles.size) return interaction.editReply({ content: "No roles available to set exclusions.", ephemeral: true });

          const selectTriggerRole = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_trigger_role:${menuId}`) // Pass menuId here
            .setPlaceholder("Select a role to set its exclusions...")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.editReply({
            content: "Please select the role that, when picked, should remove other roles:",
            components: [new ActionRowBuilder().addComponents(selectTriggerRole)],
            ephemeral: true
          });
        }

        if (action === "customize_embed") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:customize_embed:${menuId}`)
            .setTitle("Customize Embed Appearance")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("embed_color")
                  .setLabel("Embed Color (Hex Code, e.g., #FF0000)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("#5865F2")
                  .setValue(menu.embedColor || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("thumbnail_url")
                  .setLabel("Thumbnail Image URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/thumbnail.png")
                  .setValue(menu.embedThumbnail || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("image_url")
                  .setLabel("Main Image URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/image.png")
                  .setValue(menu.embedImage || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("author_name")
                  .setLabel("Author Name (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("My Awesome Bot")
                  .setValue(menu.embedAuthorName || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("author_icon_url")
                  .setLabel("Author Icon URL (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/author_icon.png")
                  .setValue(menu.embedAuthorIconURL || "")
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "customize_footer") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:customize_footer:${menuId}`)
            .setTitle("Customize Embed Footer")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("footer_text")
                  .setLabel("Footer Text")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("Select your roles below!")
                  .setValue(menu.embedFooterText || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("footer_icon_url")
                  .setLabel("Footer Icon URL (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/footer_icon.png")
                  .setValue(menu.embedFooterIconURL || "")
              )
            );
          return interaction.showModal(modal);
        }

        // New webhook toggle button handler
        if (action === "toggle_webhook") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const newStateBoolean = !menu.useWebhook; // Get the actual boolean state
          await db.saveWebhookSettings(menuId, { useWebhook: newStateBoolean });

          await interaction.editReply({
            content: `✅ Webhook sending is now ${newStateBoolean ? "ENABLED" : "DISABLED"}`,
            ephemeral: true
          });
          return showMenuConfiguration(interaction, menuId); // Refresh the menu config view
        }

        // Webhook branding configuration handler
        if (action === "config_webhook") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:webhook_branding:${menuId}`)
            .setTitle("Webhook Branding Settings")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("name")
                  .setLabel("Display Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(menu.webhookName || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("avatar")
                  .setLabel("Avatar URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(menu.webhookAvatar || "")
              )
            );
          return interaction.showModal(modal);
        }

        // Handle the clear button toggles which are now buttons
        if (action === "toggle_dropdown_clear_button") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          await db.saveEnableDropdownClearRolesButton(menuId, newStateBoolean);
          return showMenuConfiguration(interaction, menuId);
        }
        if (action === "toggle_button_clear_button") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          await db.saveEnableButtonClearRolesButton(menuId, newStateBoolean);
          return showMenuConfiguration(interaction, menuId);
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const type = parts[2]; // Can be type or triggerRoleId
      const menuId = parts[3]; // Can be menuId or menuId

      if (ctx === "rr") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.editReply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        if (action === "selectmenu") {
          const targetMenuId = interaction.values[0];
          console.log(`[Interaction] Selected menu: ${targetMenuId}`);
          return showMenuConfiguration(interaction, targetMenuId);
        }

        if (action === "selectroles") {
          const selectedRoleIds = interaction.values;
          await db.saveRoles(menuId, selectedRoleIds, type);
          await interaction.editReply({
            content: `✅ Roles saved for ${type}.`,
            components: []
          });
          return showMenuConfiguration(interaction, menuId); // Show menu configuration after saving roles
        }

        if (action === "reorder_dropdown" || action === "reorder_button") {
          const currentOrder = interaction.values;
          const type = action.split("_")[1]; // "dropdown" or "button"
          const targetMenuId = menuId; // menuId is at parts[3]
          await db.saveRoleOrder(targetMenuId, currentOrder, type);
          await interaction.editReply({ content: `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} role order saved!`, components: [] });
          return showMenuConfiguration(interaction, targetMenuId);
        }

        if (action === "select_trigger_role") {
          const triggerRoleId = interaction.values[0];
          const targetMenuId = type; // menuId is at parts[2]
          const menu = db.getMenu(targetMenuId);
          if (!menu) {
              return interaction.editReply({ content: "Menu not found. Please re-select the menu.", components: [], ephemeral: true });
          }
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id && r.id !== triggerRoleId);

          if (!allRoles.size) {
            return interaction.editReply({ content: "No other roles available to set as exclusions for this trigger role.", components: [], ephemeral: true });
          }

          const selectExclusionRoles = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_exclusion_roles:${triggerRoleId}:${targetMenuId}`)
            .setPlaceholder(`Select roles to exclude when ${interaction.guild.roles.cache.get(triggerRoleId).name} is picked...`)
            .setMinValues(0)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({
              label: r.name,
              value: r.id,
              default: (menu.exclusionMap[triggerRoleId] || []).includes(r.id)
            })));

          return interaction.editReply({
            content: `Now select roles to be **removed** when <@&${triggerRoleId}> is added:`,
            components: [new ActionRowBuilder().addComponents(selectExclusionRoles)],
            ephemeral: true
          });
        }

        if (action === "select_exclusion_roles") {
          const triggerRoleId = type; // The role that triggers the exclusion (parts[2])
          const targetMenuId = menuId; // The menuId (parts[3])
          const exclusionRoleIds = interaction.values; // The roles to be excluded

          const menu = db.getMenu(targetMenuId);
          if (!menu) {
              return interaction.editReply({ content: "Menu not found. Please re-select the menu.", components: [], ephemeral: true });
          }
          const newExclusionMap = { ...menu.exclusionMap, [triggerRoleId]: exclusionRoleIds };
          await db.saveExclusionMap(targetMenuId, newExclusionMap);

          await interaction.editReply({ content: "✅ Exclusion roles saved!", components: [], ephemeral: true });
          return showMenuConfiguration(interaction, targetMenuId);
        }

        if (action === "set_role_descriptions") {
          const roleId = interaction.values[0];
          const targetMenuId = menuId; // menuId is at parts[3]
          const menu = db.getMenu(targetMenuId);
          if (!menu) {
              return interaction.editReply({ content: "Menu not found. Please re-select the menu.", components: [], ephemeral: true });
          }
          const currentDescription = menu.dropdownRoleDescriptions[roleId] || "";
          const roleName = interaction.guild.roles.cache.get(roleId)?.name || "Unknown Role";

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:role_description:${targetMenuId}:${roleId}`)
            .setTitle(`Set Description for ${roleName}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("description_input")
                  .setLabel("Role Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("A short description for this role.")
                  .setValue(currentDescription)
              )
            );
          return interaction.showModal(modal);
        }
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const modalType = parts[2]; // This will be "create", "addemoji", "setlimits", etc.

      // Determine menuId based on modal's customId structure
      let currentMenuId;
      if (modalType === "addemoji" || modalType === "role_description") {
        currentMenuId = parts[4];
      } else {
        currentMenuId = parts[2]; // For other modals like setlimits, customize_embed, etc.
      }

      if (ctx === "rr" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.editReply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        if (modalType === "create") { // Use modalType instead of extra
          const name = interaction.fields.getTextInputValue("name");
          const desc = interaction.fields.getTextInputValue("desc");
          const newMenuId = await db.createMenu(interaction.guild.id, name, desc); // Await creation
          return showMenuConfiguration(interaction, newMenuId);
        }

        if (modalType === "addemoji") {
          if (!currentMenuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const emojis = {};
          const type = parts[3]; // 'dropdown' or 'button'
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return interaction.followUp({ content: "Menu not found.", ephemeral: true });
          }

          const roles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
          for (const roleId of roles) {
            const emojiInput = interaction.fields.getTextInputValue(roleId);
            if (emojiInput) {
              const parsed = parseEmoji(emojiInput);
              if (parsed) {
                emojis[roleId] = emojiInput;
              } else {
                // If invalid emoji, clear it from the saved emojis
                if (type === "dropdown") delete menu.dropdownEmojis[roleId];
                else delete menu.buttonEmojis[roleId];
              }
            } else {
              // If input is empty, clear the existing emoji for this role
              if (type === "dropdown") delete menu.dropdownEmojis[roleId];
              else delete menu.buttonEmojis[roleId];
            }
          }
          await db.saveEmojis(currentMenuId, emojis, type);
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "setlimits") {
          if (!currentMenuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return interaction.followUp({ content: "Menu not found.", ephemeral: true });
          }

          const auLimit = parseInt(interaction.fields.getTextInputValue("au_limit"));
          const euLimit = parseInt(interaction.fields.getTextInputValue("eu_limit"));
          const naLimit = parseInt(interaction.fields.getTextInputValue("na_limit"));
          const regionalRoleAssignmentsRaw = interaction.fields.getTextInputValue("regional_role_assignments");
          const maxRolesLimitInput = interaction.fields.getTextInputValue("max_roles_limit");

          const newRegionalLimits = {};
          if (!isNaN(auLimit) && auLimit >= 0) newRegionalLimits.AU = { limit: auLimit };
          if (!isNaN(euLimit) && euLimit >= 0) newRegionalLimits.EU = { limit: euLimit };
          if (!isNaN(naLimit) && naLimit >= 0) newRegionalLimits.NA = { limit: naLimit };

          try {
            if (regionalRoleAssignmentsRaw) {
              const parsedAssignments = JSON.parse(regionalRoleAssignmentsRaw);
              for (const [region, roleIds] of Object.entries(parsedAssignments)) {
                if (Array.isArray(roleIds)) {
                  if (newRegionalLimits[region]) {
                    newRegionalLimits[region].roleIds = roleIds;
                  } else {
                    newRegionalLimits[region] = { roleIds };
                  }
                }
              }
            }
          } catch (jsonError) {
            return interaction.followUp({ content: "❌ Invalid JSON for Regional Role Assignments. Please check the format.", ephemeral: true });
          }

          await db.saveRegionalLimits(currentMenuId, newRegionalLimits);

          let maxRolesLimit = null;
          if (maxRolesLimitInput) {
            const parsedLimit = parseInt(maxRolesLimitInput);
            if (!isNaN(parsedLimit) && parsedLimit >= 0) {
              maxRolesLimit = parsedLimit;
            } else {
              return interaction.followUp({ content: "❌ Invalid value for Max Roles Per Menu. Please enter a number.", ephemeral: true });
            }
          }
          await db.saveMaxRolesLimit(currentMenuId, maxRolesLimit);
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "customize_embed") {
          if (!currentMenuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return interaction.followUp({ content: "Menu not found.", ephemeral: true });
          }

          const embedColor = interaction.fields.getTextInputValue("embed_color") || null;
          const embedThumbnail = interaction.fields.getTextInputValue("thumbnail_url") || null;
          const embedImage = interaction.fields.getTextInputValue("image_url") || null;
          const embedAuthorName = interaction.fields.getTextInputValue("author_name") || null;
          const embedAuthorIconURL = interaction.fields.getTextInputValue("author_icon_url") || null;

          await db.saveEmbedCustomization(currentMenuId, {
            embedColor,
            embedThumbnail,
            embedImage,
            embedAuthorName,
            embedAuthorIconURL,
          });
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "customize_footer") {
          if (!currentMenuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return interaction.followUp({ content: "Menu not found.", ephemeral: true });
          }

          const footerText = interaction.fields.getTextInputValue("footer_text") || null;
          const footerIconURL = interaction.fields.getTextInputValue("footer_icon_url") || null;

          await db.saveEmbedCustomization(currentMenuId, {
            embedFooterText: footerText,
            embedFooterIconURL: footerIconURL,
          });
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "custom_messages") {
          if (!currentMenuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return interaction.followUp({ content: "Menu not found.", ephemeral: true });
          }

          const successAdd = interaction.fields.getTextInputValue("success_add_message") || null;
          const successRemove = interaction.fields.getTextInputValue("success_remove_message") || null;
          const limitExceeded = interaction.fields.getTextInputValue("limit_exceeded_message") || null;

          await db.saveCustomMessages(currentMenuId, {
            successMessageAdd: successAdd || "✅ You now have the role <@&{roleId}>!",
            successMessageRemove: successRemove || "✅ You removed the role <@&{roleId}>!",
            limitExceededMessage: limitExceeded || "❌ You have reached the maximum number of roles for this menu or region.",
          });
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "role_description") {
          const roleId = parts[4]; // roleId is at parts[4] for this modal
          if (!currentMenuId || !roleId) return interaction.editReply({ content: "Menu ID or Role ID missing.", ephemeral: true });
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return interaction.followUp({ content: "Menu not found.", ephemeral: true });
          }
          const description = interaction.fields.getTextInputValue("description_input");
          await db.saveRoleDescriptions(currentMenuId, { [roleId]: description || null });
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "webhook_branding") {
          if (!currentMenuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return interaction.followUp({ content: "Menu not found.", ephemeral: true });
          }

          const name = interaction.fields.getTextInputValue("name");
          const avatar = interaction.fields.getTextInputValue("avatar");

          await db.saveWebhookSettings(currentMenuId, {
            webhookName: name || null,
            webhookAvatar: avatar || null
          });
          return showMenuConfiguration(interaction, currentMenuId);
        }
      }
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
    } else if (interaction.deferred) {
      await interaction.editReply({ content: "❌ Something went wrong after deferring. Please try again.", ephemeral: true }).catch(e => console.error("Error editing deferred reply:", e));
    }
  }
});

client.login(process.env.TOKEN);
