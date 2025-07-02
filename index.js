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
  PermissionsBitField,
  MessageFlags,
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
  // Assign a dummy projectId to allow the app to run (without persistence) if config is missing
  firebaseConfig.projectId = 'missing-project-id';
}

const firebaseApp = initializeApp(firebaseConfig);
const dbFirestore = getFirestore(firebaseApp);

/**
 * Helper function to get or create a webhook for a given channel.
 * This is used for sending messages with custom branding.
 * @param {import('discord.js').TextChannel} channel - The channel to get/create the webhook in.
 * @param {string} [name="Role Menu Webhook"] - The desired name for the webhook.
 * @returns {Promise<import('discord.js').Webhook>} The webhook instance.
 */
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

/**
 * A custom database abstraction layer to manage reaction role menus.
 * It uses in-memory maps for quick access and synchronizes with Firestore for persistence.
 */
const db = {
  // Map to store guildId -> [menuId, ...] for quick lookup of menus per guild
  menus: new Map(),
  // Map to store menuId -> menuObject for quick access to menu data
  menuData: new Map(),

  /**
   * Loads all reaction role menus from Firestore into memory.
   * This should be called once when the bot starts.
   */
  async loadAllMenus() {
    console.log("[Firestore] Loading all menus...");
    if (firebaseConfig.projectId === 'missing-project-id') {
      console.warn("[Firestore] Skipping menu loading: projectId is missing or invalid. Please configure Firebase.");
      return;
    }
    try {
      const menusCollectionRef = collection(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`);
      const querySnapshot = await getDocs(menusCollectionRef);
      this.menus.clear(); // Clear existing in-memory data
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

  /**
   * Creates a new reaction role menu and saves it to Firestore.
   * @param {string} guildId - The ID of the guild where the menu is created.
   * @param {string} name - The name of the menu.
   * @param {string} desc - The description for the menu's embed.
   * @returns {Promise<string>} The ID of the newly created menu.
   */
  async createMenu(guildId, name, desc) {
    // Generate a unique ID for the new menu
    const id = Date.now().toString() + Math.floor(Math.random() * 1000).toString();
    const newMenu = {
      guildId,
      name,
      desc,
      dropdownRoles: [],
      buttonRoles: [],
      selectionType: [], // 'dropdown', 'button', or 'both'
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
      console.warn("[Firestore] Skipping menu creation: projectId is missing or invalid. Data will not persist.");
      if (!this.menus.has(guildId)) {
        this.menus.set(guildId, []);
      }
      this.menus.get(guildId).push(id);
      this.menuData.set(id, newMenu);
      return id;
    }

    try {
      const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, id);
      await setDoc(menuDocRef, newMenu); // Save to Firestore

      if (!this.menus.has(guildId)) {
        this.menus.set(guildId, []);
      }
      this.menus.get(guildId).push(id);
      this.menuData.set(id, newMenu); // Save to in-memory map
      console.log(`[Firestore] Created new menu with ID: ${id}`);
      return id;
    } catch (error) {
      console.error("[Firestore] Error creating menu:", error);
      throw new Error("Failed to create menu in Firestore. Check permissions.");
    }
  },

  /**
   * Retrieves all menus for a specific guild.
   * @param {string} guildId - The ID of the guild.
   * @returns {Array<Object>} An array of menu objects.
   */
  getMenus(guildId) {
    return (this.menus.get(guildId) || []).map((id) => ({ id, ...this.menuData.get(id) }));
  },

  /**
   * Updates an existing menu's data in both memory and Firestore.
   * @param {string} menuId - The ID of the menu to update.
   * @param {Object} data - The partial data object to merge into the existing menu.
   */
  async updateMenu(menuId, data) {
    const menu = this.menuData.get(menuId);
    if (!menu) {
      console.warn(`[Firestore] Attempted to update non-existent menu: ${menuId}`);
      return;
    }
    Object.assign(menu, data); // Update in-memory map

    if (firebaseConfig.projectId === 'missing-project-id') {
      console.warn("[Firestore] Skipping menu update: projectId is missing or invalid. Data will not persist.");
      return;
    }

    try {
      const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, menuId);
      await setDoc(menuDocRef, menu); // Overwrite with updated data in Firestore
      console.log(`[Firestore] Updated menu with ID: ${menuId}`);
    } catch (error) {
      console.error(`[Firestore] Error updating menu ${menuId}:`, error);
      throw new Error("Failed to update menu in Firestore. Check permissions.");
    }
  },

  /**
   * Saves the selected roles for a menu, by type (dropdown or button).
   * @param {string} menuId - The ID of the menu.
   * @param {string[]} roles - An array of role IDs.
   * @param {'dropdown'|'button'} type - The type of roles ('dropdown' or 'button').
   */
  async saveRoles(menuId, roles, type) {
    const updateData = {};
    if (type === "dropdown") updateData.dropdownRoles = roles;
    if (type === "button") updateData.buttonRoles = roles;
    await this.updateMenu(menuId, updateData);
  },

  /**
   * Saves the selection type for a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {string[]} types - An array containing 'dropdown', 'button', or both.
   */
  async saveSelectionType(menuId, types) {
    await this.updateMenu(menuId, { selectionType: types });
  },

  /**
   * Saves emojis for roles within a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {Object} emojis - An object mapping role IDs to emoji strings.
   * @param {'dropdown'|'button'} type - The type of roles ('dropdown' or 'button').
   */
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

  /**
   * Saves regional role limits for a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {Object} regionalLimits - An object defining regional limits.
   */
  async saveRegionalLimits(menuId, regionalLimits) {
    await this.updateMenu(menuId, { regionalLimits });
  },

  /**
   * Saves the exclusion map for a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {Object} exclusionMap - An object mapping trigger role IDs to arrays of excluded role IDs.
   */
  async saveExclusionMap(menuId, exclusionMap) {
    await this.updateMenu(menuId, { exclusionMap });
  },

  /**
   * Saves the maximum number of roles a user can have from a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {number|null} limit - The maximum limit, or null for no limit.
   */
  async saveMaxRolesLimit(menuId, limit) {
    await this.updateMenu(menuId, { maxRolesLimit: limit });
  },

  /**
   * Saves custom success/error messages for a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {Object} messages - An object containing custom message strings.
   */
  async saveCustomMessages(menuId, messages) {
    await this.updateMenu(menuId, messages);
  },

  /**
   * Saves the display order of roles for a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {string[]} order - An array of role IDs in the desired order.
   * @param {'dropdown'|'button'} type - The type of roles ('dropdown' or 'button').
   */
  async saveRoleOrder(menuId, order, type) {
    const updateData = {};
    if (type === "dropdown") updateData.dropdownRoleOrder = order;
    if (type === "button") updateData.buttonRoleOrder = order;
    await this.updateMenu(menuId, updateData);
  },

  /**
   * Saves descriptions for dropdown roles.
   * @param {string} menuId - The ID of the menu.
   * @param {Object} descriptions - An object mapping role IDs to their descriptions.
   */
  async saveRoleDescriptions(menuId, descriptions) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    const updatedDescriptions = { ...menu.dropdownRoleDescriptions, ...descriptions };
    await this.updateMenu(menuId, { dropdownRoleDescriptions: updatedDescriptions });
  },

  /**
   * Saves embed customization settings for a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {Object} embedSettings - An object containing embed properties.
   */
  async saveEmbedCustomization(menuId, embedSettings) {
    await this.updateMenu(menuId, embedSettings);
  },

  /**
   * Toggles the clear roles button for dropdowns.
   * @param {string} menuId - The ID of the menu.
   * @param {boolean} enabled - Whether the button should be enabled.
   */
  async saveEnableDropdownClearRolesButton(menuId, enabled) {
    await this.updateMenu(menuId, { enableDropdownClearRolesButton: enabled });
  },

  /**
   * Toggles the clear roles button for buttons.
   * @param {string} menuId - The ID of the menu.
   * @param {boolean} enabled - Whether the button should be enabled.
   */
  async saveEnableButtonClearRolesButton(menuId, enabled) {
    await this.updateMenu(menuId, { enableButtonClearRolesButton: enabled });
  },

  /**
   * Retrieves a single menu by its ID.
   * @param {string} menuId - The ID of the menu.
   * @returns {Object|undefined} The menu object, or undefined if not found.
   */
  getMenu(menuId) {
    return this.menuData.get(menuId);
  },

  /**
   * Saves the channel and message ID of a published menu.
   * @param {string} menuId - The ID of the menu.
   * @param {string} channelId - The ID of the channel where the message is published.
   * @param {string} messageId - The ID of the published message.
   */
  async saveMessageId(menuId, channelId, messageId) {
    await this.updateMenu(menuId, { channelId, messageId });
  },

  /**
   * Clears the message ID and channel ID for a menu, indicating it's no longer published.
   * @param {string} menuId - The ID of the menu.
   */
  async clearMessageId(menuId) {
    await this.updateMenu(menuId, { channelId: null, messageId: null });
  },

  /**
   * Saves webhook-related settings for a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {Object} settings - An object containing webhook settings (e.g., useWebhook, webhookName, webhookAvatar).
   */
  async saveWebhookSettings(menuId, settings) {
    await this.updateMenu(menuId, settings);
  },

  /**
   * Deletes a menu from both memory and Firestore.
   * @param {string} menuId - The ID of the menu to delete.
   */
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
};

/**
 * Helper function to parse emoji strings for Discord components.
 * Handles both custom emojis (<:name:id>, <a:name:id>) and unicode emojis.
 * @param {string} emoji - The emoji string.
 * @returns {Object|undefined} An emoji object suitable for Discord.js components, or undefined if invalid.
 */
function parseEmoji(emoji) {
  if (!emoji) return undefined;

  const customEmojiRegex = /^<a?:([a-zA-Z0-9_]+):(\d+)>$/;
  const match = emoji.match(customEmojiRegex);

  if (match) {
    return {
      id: match[2],
      name: match[1],
      animated: emoji.startsWith("<a:"),
    };
  }
  // Basic check for unicode emoji (not exhaustive but covers common cases)
  // This regex matches a wide range of Unicode emoji blocks
  const unicodeEmojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
  if (emoji.match(unicodeEmojiRegex)) {
    return { name: emoji };
  }

  console.warn(`Invalid emoji format detected: "${emoji}". Returning undefined.`);
  return undefined;
}

/**
 * Checks if a member's potential new roles violate any regional limits defined in the menu.
 * @param {import('discord.js').GuildMember} member - The member whose roles are being checked.
 * @param {Object} menu - The menu object containing regional limits.
 * @param {string[]} newRoleIds - An array of role IDs the member would have after the current interaction.
 * @returns {string[]} An array of violation messages, or empty if no violations.
 */
function checkRegionalLimits(member, menu, newRoleIds) {
  const violations = [];

  for (const [regionName, regionData] of Object.entries(menu.regionalLimits || {})) {
    const { limit, roleIds } = regionData;
    if (!limit || !roleIds || !roleIds.length) continue;

    // Count how many roles from this region are in the potential newRoleIds
    const rolesInRegion = newRoleIds.filter(roleId => roleIds.includes(roleId));

    if (rolesInRegion.length > limit) {
      violations.push(`You can only select ${limit} role(s) from the ${regionName} region.`);
    }
  }
  return violations;
}

/**
 * Creates an EmbedBuilder for the reaction role message based on menu settings.
 * @param {import('discord.js').Guild} guild - The guild object.
 * @param {Object} menu - The menu object containing embed customization settings.
 * @returns {EmbedBuilder} The configured EmbedBuilder instance.
 */
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

/**
 * Updates the components (dropdowns and buttons) on a published reaction role message
 * to reflect the current roles held by the interacting member.
 * This is crucial for keeping the UI in sync with the user's state.
 * @param {import('discord.js').Interaction} interaction - The interaction that triggered the update.
 * @param {Object} menu - The menu object.
 */
async function updatePublishedMessageComponents(interaction, menu) {
    if (!menu.channelId || !menu.messageId) return;

    const guild = interaction.guild;
    const member = interaction.member;

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
                    emoji: parseEmoji(menu.dropdownEmojis[role.id]),
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

        // Rebuild Buttons (no default state for buttons, they are stateless, but we can highlight them)
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
                username: menu.webhookName || interaction.guild.me.displayName,
                avatarURL: menu.webhookAvatar || interaction.guild.me.displayAvatarURL(),
            });
        } else {
            await originalMessage.edit({ embeds: [publishedEmbed], components });
        }

    } catch (error) {
        console.error("Error updating published message components:", error);
        // If the message or channel is gone, clear the message ID from the menu
        if (error.code === 10003 || error.code === 50001) { // Unknown Channel or Missing Access
            console.log(`Clearing message ID for menu ${menu.id} due to channel/message access error.`);
            await db.clearMessageId(menu.id);
        }
    }
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.MessageContent, // Required for some message-related operations if needed, though not directly used for RR logic here.
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember], // Ensure partials are enabled for caching
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // Load all menus from Firestore when the bot starts
  await db.loadAllMenus();

  const rest = new REST().setToken(process.env.TOKEN);
  const cmd = new SlashCommandBuilder().setName("dashboard").setDescription("Open the guild dashboard").toJSON();
  try {
    // Deploying guild commands for a specific guild for faster updates during development
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
    console.log(" /dashboard command deployed to guild.");
  } catch (error) {
    console.error("Error deploying slash command:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  // Defer reply for most interactions to prevent timeout,
  // EXCEPT for interactions that immediately show a modal.
  const isModalTrigger = (
    (interaction.isButton() && interaction.customId === "rr:create") ||
    (interaction.isButton() && interaction.customId.startsWith("rr:addemoji:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:setlimits:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:customize_embed:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:customize_footer:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:config_webhook:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:set_role_descriptions:")) // Select menu that leads to a modal
  );

  if (!interaction.replied && !interaction.deferred && !isModalTrigger) {
    await interaction.deferReply({ ephemeral: true }).catch(e => console.error("Error deferring reply:", e));
  }

  // Check Firebase configuration at the start of every interaction that might involve persistence
  if (firebaseConfig.projectId === 'missing-project-id' &&
      (interaction.isChatInputCommand() || interaction.customId?.startsWith("rr:"))) { // Only show warning for relevant interactions
    // Use followUp since the interaction is now deferred (or was intended to be deferred)
    // For modals, this will be followUp after the modal submit. For other interactions, after initial defer.
    // Ensure we don't send multiple follow-ups if already replied.
    if (!interaction.replied) {
      await interaction.followUp({
        content: "⚠️ **Warning: Firebase is not fully configured.** Your bot's data (menus, roles, etc.) will not be saved or loaded persistently. Please ensure `FIREBASE_CONFIG` in your environment provides a valid `projectId`.",
        ephemeral: true
      }).catch(e => console.error("Error sending Firebase config warning:", e));
    }
    // If Firebase is not configured, prevent further processing for persistence-related commands
    // This prevents errors from trying to access Firestore when it's not set up.
    if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") return;
    if (interaction.isButton() && interaction.customId.startsWith("rr:")) return;
    if (interaction.isModalSubmit() && interaction.customId.startsWith("rr:modal:")) return;
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:")) return;
  }

  try {
    // Slash Command Handling
    if (interaction.isChatInputCommand()) {
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

      let menuId;
      let type;
      let newStateBoolean;

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
        } else if (["publish", "edit_published", "delete_published", "confirm_delete_published", "cancel_delete_published", "setlimits", "setexclusions", "customize_embed", "customize_footer", "toggle_webhook", "config_webhook", "delete_menu", "confirm_delete_menu", "cancel_delete_menu", "custom_messages"].includes(action)) {
          menuId = parts[2]; // For these actions, menuId is parts[2]
        } else if (["type", "addemoji"].includes(action)) {
          type = parts[2]; // 'dropdown', 'button', 'both' for type; 'dropdown', 'button' for addemoji
          menuId = parts[3]; // For these actions, menuId is parts[3]
        } else if (["toggle_dropdown_clear_button", "toggle_button_clear_button"].includes(action)) {
          menuId = parts[2];
          newStateBoolean = parts[3] === 'true'; // Convert string 'true'/'false' to boolean
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
          return interaction.showModal(modal);
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
            return publishMenu(interaction, menuId, message); // Pass the fetched message to edit
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
            .setLabel("Confirm Delete Published Message")
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
            await db.clearMessageId(menuId); // Clear ID even if channel is gone
            return interaction.editReply({ content: "❌ Published channel not found. Message ID cleared.", components: [], ephemeral: true });
          }

          try {
            const message = await channel.messages.fetch(menu.messageId);
            await message.delete();
            await db.clearMessageId(menuId); // Clear message ID from the menu in DB
            await interaction.editReply({
              content: "✅ Published message deleted successfully!",
              components: [],
              ephemeral: true
            });
            return showMenuConfiguration(interaction, menuId); // Refresh the menu config view
          } catch (error) {
            console.error("Error deleting message:", error);
            await db.clearMessageId(menuId); // Clear ID if deletion fails (e.g., message already deleted)
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

        if (action === "delete_menu") {
            if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
            const confirmButton = new ButtonBuilder()
                .setCustomId(`rr:confirm_delete_menu:${menuId}`)
                .setLabel("Confirm Delete Menu")
                .setStyle(ButtonStyle.Danger);
            const cancelButton = new ButtonBuilder()
                .setCustomId(`rr:cancel_delete_menu:${menuId}`)
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            return interaction.editReply({
                content: "⚠️ Are you sure you want to delete this entire menu? This will remove all its configurations and cannot be undone.",
                components: [row],
                ephemeral: true
            });
        }

        if (action === "confirm_delete_menu") {
            if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], ephemeral: true });
            const menu = db.getMenu(menuId);
            if (!menu) {
                return interaction.editReply({ content: "❌ Menu not found or already deleted.", components: [], ephemeral: true });
            }

            try {
                // If there's a published message, attempt to delete it first
                if (menu.channelId && menu.messageId) {
                    try {
                        const channel = interaction.guild.channels.cache.get(menu.channelId);
                        if (channel) {
                            const message = await channel.messages.fetch(menu.messageId);
                            await message.delete();
                        }
                    } catch (error) {
                        console.log("Couldn't delete associated published message, probably already deleted or not found.");
                    }
                }
                await db.deleteMenu(menuId);
                await interaction.editReply({
                    content: "✅ Menu and its associated published message (if any) deleted successfully!",
                    components: [],
                    ephemeral: true
                });
                return showReactionRolesDashboard(interaction); // Go back to the main RR dashboard
            } catch (error) {
                console.error("Error deleting menu:", error);
                return interaction.editReply({
                    content: `❌ Failed to delete menu: ${error.message}`,
                    ephemeral: true
                });
            }
        }

        if (action === "cancel_delete_menu") {
            if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], ephemeral: true });
            await interaction.editReply({ content: "Menu deletion cancelled.", components: [], ephemeral: true });
            return showMenuConfiguration(interaction, menuId); // Go back to the menu configuration
        }

        if (action === "type") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing for selection type.", ephemeral: true });
          let selectedTypes = type === "both" ? ["dropdown", "button"] : [type];
          await db.saveSelectionType(menuId, selectedTypes);

          // After setting type, prompt user to select roles for the chosen type(s)
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          if (allRoles.size === 0) {
            return interaction.editReply({
              content: "✅ Selection type saved. No roles available in this guild to add. Please create some roles first.",
              components: [],
              ephemeral: true
            });
          }

          const select = new StringSelectMenuBuilder()
            .setCustomId(`rr:selectroles:${type}:${menuId}`) // Use 'type' directly as it's either 'dropdown' or 'button' or 'both'
            .setMinValues(0) // Allow selecting 0 roles initially
            .setMaxValues(Math.min(allRoles.size, 25)) // Max 25 options per select menu
            .addOptions(allRoles.map((r) => ({ label: r.name, value: r.id })));

          return interaction.editReply({
            content: `✅ Selection type saved. Now select roles for **${type}** (you can select multiple):`,
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true
          });
        }

        if (action === "addemoji") {
          if (!menuId || !type) return interaction.editReply({ content: "Menu ID or type missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder().setCustomId(`rr:modal:addemoji:${type}:${menuId}`).setTitle(`Add Emojis for ${type}`);

          const roles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
          if (roles.length === 0) {
            return interaction.editReply({ content: `No roles configured for ${type} menu. Add roles first.`, ephemeral: true });
          }

          // Limit to 5 inputs per modal (Discord modal limitation)
          const maxInputs = Math.min(roles.length, 5);
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
          return interaction.showModal(modal);
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
                  .setLabel("Limit For AU Roles (Number, 0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits?.AU?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("eu_limit")
                  .setLabel("Limit For EU Roles (Number, 0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits?.EU?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("na_limit")
                  .setLabel("Limit For NA Roles (Number, 0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits?.NA?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("regional_role_assignments")
                  .setLabel("Regional Role Assignments (JSON Array of IDs)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('{"AU": ["roleId1", "roleId2"], "EU": ["roleId3"]}')
                  .setRequired(false)
                  .setValue(JSON.stringify(Object.fromEntries(
                    Object.entries(menu.regionalLimits || {}).map(([region, data]) => [region, data.roleIds || []])
                  )) || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("max_roles_limit")
                  .setLabel("Max Roles Per Menu (Number, 0 for no limit)")
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
            .setCustomId(`rr:select_trigger_role:${menuId}`)
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

        if (action === "custom_messages") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:custom_messages:${menuId}`)
            .setTitle("Customize Response Messages")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("success_add_message")
                  .setLabel("Success Message (Role Added)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("✅ You now have the role <@&{roleId}>!")
                  .setValue(menu.successMessageAdd || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("success_remove_message")
                  .setLabel("Success Message (Role Removed)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("✅ You removed the role <@&{roleId}>!")
                  .setValue(menu.successMessageRemove || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("limit_exceeded_message")
                  .setLabel("Limit Exceeded Message")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("❌ You have reached the maximum number of roles for this menu or region.")
                  .setValue(menu.limitExceededMessage || "")
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
                  .setPlaceholder("https://example.com/avatar.png")
                  .setValue(menu.webhookAvatar || "")
              )
            );
          return interaction.showModal(modal);
        }

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
      // Note: parts[2] and parts[3] can vary based on the customId structure
      // For 'selectmenu', parts[2] is the menuId.
      // For 'selectroles', parts[2] is the type, parts[3] is the menuId.
      // For 'reorder_dropdown'/'reorder_button', parts[2] is the menuId.
      // For 'select_trigger_role', parts[2] is the menuId.
      // For 'select_exclusion_roles', parts[2] is triggerRoleId, parts[3] is menuId.
      // For 'set_role_descriptions', parts[2] is menuId.

      if (ctx === "rr") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.editReply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        if (action === "selectmenu") {
          const targetMenuId = interaction.values[0];
          return showMenuConfiguration(interaction, targetMenuId);
        }

        if (action === "selectroles") {
          const selectedRoleIds = interaction.values;
          const type = parts[2]; // 'dropdown' or 'button'
          const menuId = parts[3];
          await db.saveRoles(menuId, selectedRoleIds, type);
          await interaction.editReply({
            content: `✅ Roles saved for ${type}.`,
            components: [],
            ephemeral: true
          });
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "reorder_dropdown" || action === "reorder_button") {
          const currentOrder = interaction.values;
          const type = action.split("_")[1]; // "dropdown" or "button"
          const menuId = parts[2]; // menuId is at parts[2] for reorder selects
          await db.saveRoleOrder(menuId, currentOrder, type);
          await interaction.editReply({ content: `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} role order saved!`, components: [], ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "select_trigger_role") {
          const triggerRoleId = interaction.values[0];
          const menuId = parts[2]; // menuId is at parts[2] for select_trigger_role
          const menu = db.getMenu(menuId);
          if (!menu) {
              return interaction.editReply({ content: "Menu not found. Please re-select the menu.", components: [], ephemeral: true });
          }
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id && r.id !== triggerRoleId);

          if (!allRoles.size) {
            return interaction.editReply({ content: "No other roles available to set as exclusions for this trigger role.", ephemeral: true });
          }

          const selectExclusionRoles = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_exclusion_roles:${triggerRoleId}:${menuId}`)
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
          const triggerRoleId = parts[2]; // The role that triggers the exclusion
          const menuId = parts[3]; // The menuId
          const exclusionRoleIds = interaction.values; // The roles to be excluded

          const menu = db.getMenu(menuId);
          if (!menu) {
              return interaction.editReply({ content: "Menu not found. Please re-select the menu.", components: [], ephemeral: true });
          }
          const newExclusionMap = { ...menu.exclusionMap, [triggerRoleId]: exclusionRoleIds };
          await db.saveExclusionMap(menuId, newExclusionMap);

          await interaction.editReply({ content: "✅ Exclusion roles saved!", components: [], ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "set_role_descriptions") {
          const roleId = interaction.values[0];
          const menuId = parts[2]; // menuId is at parts[2] for set_role_descriptions
          const menu = db.getMenu(menuId);
          if (!menu) {
              return interaction.editReply({ content: "Menu not found. Please re-select the menu.", components: [], ephemeral: true });
          }
          const currentDescription = menu.dropdownRoleDescriptions[roleId] || "";
          const roleName = interaction.guild.roles.cache.get(roleId)?.name || "Unknown Role";

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:role_description:${menuId}:${roleId}`)
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
      // Defer the modal submission immediately to prevent timeout
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate().catch(e => console.error("Error deferring modal update:", e));
      }

      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const modalType = parts[2];

      let currentMenuId;
      if (modalType === "create") {
          currentMenuId = null; // No menuId yet for creation modal
      } else if (modalType === "addemoji" || modalType === "role_description") {
          currentMenuId = parts[4]; // Specific case where type is parts[3] and menuId is parts[4]
      } else {
          currentMenuId = parts[3]; // Default for other modals like setlimits, customize_embed, webhook_branding, etc.
      }

      if (ctx === "rr" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            // Use followUp here as the interaction has already been deferred by deferUpdate above.
            return interaction.followUp({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        if (modalType === "create") {
          const name = interaction.fields.getTextInputValue("name");
          const desc = interaction.fields.getTextInputValue("desc");
          const newMenuId = await db.createMenu(interaction.guild.id, name, desc);
          // No need for deferUpdate here anymore, it's done at the top of modal submit block
          return showMenuConfiguration(interaction, newMenuId);
        }

        if (modalType === "addemoji") {
          if (!currentMenuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const emojis = {};
          const type = parts[3];
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return interaction.followUp({ content: "Menu not found.", ephemeral: true });
          }

          const roles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
          for (let i = 0; i < Math.min(roles.length, 5); i++) {
            const roleId = roles[i];
            const emojiInput = interaction.fields.getTextInputValue(roleId);
            if (emojiInput) {
              const parsed = parseEmoji(emojiInput);
              if (parsed) {
                emojis[roleId] = emojiInput;
              } else {
                console.warn(`Invalid emoji for role ${roleId}: ${emojiInput}. Not saving.`);
              }
            } else {
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
          const roleId = parts[4];
          if (!currentMenuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
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

    // Role adding/removing on select menu or button press (User-facing)
    if ((interaction.isStringSelectMenu() && interaction.customId.startsWith("rr-role-select:")) ||
        (interaction.isButton() && interaction.customId.startsWith("rr-role-button:"))) {

        // Ensure interaction is deferred if it wasn't already (e.g., for direct button clicks)
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ ephemeral: true }).catch(e => console.error("Error deferring reply for role interaction:", e));
        }

        const menuId = interaction.customId.split(":")[1];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.editReply({ content: "❌ This reaction role menu is no longer valid.", ephemeral: true });

        const selectedRoleIds = interaction.isStringSelectMenu() ? interaction.values : [interaction.customId.split(":")[2]];

        let rolesToAdd = [];
        let rolesToRemove = [];
        let messages = [];

        const currentMemberRoleIds = interaction.member.roles.cache.map(r => r.id);
        const allMenuRoleIds = [...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])];
        const currentMenuRolesHeldByMember = currentMemberRoleIds.filter(id => allMenuRoleIds.includes(id));

        // Determine roles to add and remove based on selection and current member roles
        // For select menus, selectedRoleIds are the *desired* final state of roles from the dropdown.
        // For buttons, selectedRoleIds is just the single role associated with the button.
        if (interaction.isStringSelectMenu()) {
            rolesToAdd = selectedRoleIds.filter(id => !currentMemberRoleIds.includes(id));
            rolesToRemove = currentMenuRolesHeldByMember.filter(id => !selectedRoleIds.includes(id));
        } else { // Button interaction
            const clickedRoleId = selectedRoleIds[0];
            if (currentMemberRoleIds.includes(clickedRoleId)) {
                rolesToRemove.push(clickedRoleId);
            } else {
                rolesToAdd.push(clickedRoleId);
            }
        }

        // Handle exclusions: if a role is being added, check if it excludes any existing roles
        let rolesToRemoveByExclusion = [];
        for (const roleIdBeingAdded of rolesToAdd) {
            if (menu.exclusionMap && menu.exclusionMap[roleIdBeingAdded]) {
                const excludedRolesForThisAdd = menu.exclusionMap[roleIdBeingAdded].filter(id => currentMemberRoleIds.includes(id));
                if (excludedRolesForThisAdd.length > 0) {
                    rolesToRemoveByExclusion.push(...excludedRolesForThisAdd);
                    const removedRoleNames = excludedRolesForThisAdd.map(id => interaction.guild.roles.cache.get(id)?.name || 'Unknown Role').join(', ');
                    messages.push(`Removed conflicting roles: ${removedRoleNames}`);
                }
            }
        }
        rolesToRemove.push(...rolesToRemoveByExclusion);
        rolesToRemove = [...new Set(rolesToRemove)]; // Ensure no duplicates in rolesToRemove

        // Calculate the potential new set of roles after this interaction for limit checks
        let potentialNewRoleIds = currentMemberRoleIds
            .filter(id => !rolesToRemove.includes(id)) // Start with current roles, remove those being removed
            .concat(rolesToAdd); // Add those being added
        potentialNewRoleIds = [...new Set(potentialNewRoleIds)]; // Final deduplication for limit check

        // Filter potentialNewRoleIds to only include roles from THIS menu for limit checks
        const potentialMenuRoleIds = potentialNewRoleIds.filter(id => allMenuRoleIds.includes(id));

        // Check regional limits
        const regionalViolations = checkRegionalLimits(interaction.member, menu, potentialMenuRoleIds);
        if (regionalViolations.length > 0) {
            await interaction.editReply({ content: menu.limitExceededMessage || `❌ ${regionalViolations.join("\n")}`, ephemeral: true });
            await updatePublishedMessageComponents(interaction, menu); // Re-sync components on published message
            return;
        }

        // Check overall max roles limit
        if (menu.maxRolesLimit !== null && menu.maxRolesLimit > 0) {
            if (potentialMenuRoleIds.length > menu.maxRolesLimit) {
                await interaction.editReply({ content: menu.limitExceededMessage || `❌ You can only have a maximum of ${menu.maxRolesLimit} roles from this menu.`, ephemeral: true });
                await updatePublishedMessageComponents(interaction, menu); // Re-sync components on published message
                return;
            }
        }

        // Add success/remove messages for roles based on final add/remove lists
        rolesToAdd.forEach(id => {
            messages.push((menu.successMessageAdd || "✅ You now have the role <@&{roleId}>!").replace("{roleId}", id));
        });
        rolesToRemove.forEach(id => {
            // Only add a remove message if the role was actually removed by the user's action or exclusion
            // and not if it was just not selected in a multi-select but the user didn't have it anyway.
            if (currentMemberRoleIds.includes(id)) { // Only if the member actually had the role
                messages.push((menu.successMessageRemove || "✅ You removed the role <@&{roleId}>!").replace("{roleId}", id));
            }
        });

        try {
            if (rolesToAdd.length > 0) {
                await interaction.member.roles.add(rolesToAdd);
            }
            if (rolesToRemove.length > 0) {
                await interaction.member.roles.remove(rolesToRemove);
            }

            if (messages.length > 0) {
                await interaction.editReply({ content: messages.join("\n"), ephemeral: true });
            } else {
                await interaction.editReply({ content: "No changes made to your roles.", ephemeral: true });
            }

            // Update the original published message components to reflect current selections
            await updatePublishedMessageComponents(interaction, menu);

        } catch (error) {
            console.error("Error updating roles:", error);
            if (error.code === 50013) { // Missing Permissions
                await interaction.editReply({ content: "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.", ephemeral: true });
            } else {
                await interaction.editReply({ content: "❌ There was an error updating your roles.", ephemeral: true });
            }
        }
    }

    // Handle Clear All Roles Button (User-facing)
    if (interaction.isButton() && interaction.customId.startsWith("rr-clear-roles:")) {
        // Ensure interaction is deferred if it wasn't already
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ ephemeral: true }).catch(e => console.error("Error deferring reply for clear roles button:", e));
        }

        const menuId = interaction.customId.split(":")[1];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.editReply({ content: "❌ This reaction role menu is no longer valid.", ephemeral: true });

        const allMenuRoleIds = [...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])];
        const rolesToRemove = interaction.member.roles.cache.filter(role => allMenuRoleIds.includes(role.id)).map(role => role.id);

        if (rolesToRemove.length === 0) {
            return interaction.editReply({ content: "You don't have any roles from this menu to clear.", ephemeral: true });
        }

        try {
            await interaction.member.roles.remove(rolesToRemove);
            await interaction.editReply({ content: "✅ All roles from this menu have been cleared.", ephemeral: true });
            await updatePublishedMessageComponents(interaction, menu); // Update published message after clearing
        } catch (error) {
                console.error("Error clearing roles:", error);
                if (error.code === 50013) {
                    await interaction.editReply({ content: "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.", ephemeral: true });
                } else {
                    await interaction.editReply({ content: "❌ There was an error clearing your roles.", ephemeral: true });
                }
            }
        }

    } catch (error) {
        console.error("Unhandled error during interaction:", error);
        // Fallback error reply if no other reply has been sent
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "❌ An unexpected error occurred. Please try again.", ephemeral: true }).catch(e => console.error("Error sending initial error reply:", e));
        } else if (interaction.deferred) {
            await interaction.editReply({ content: "❌ An unexpected error occurred after deferring. Please try again.", ephemeral: true }).catch(e => console.error("Error editing deferred reply for unhandled error:", e));
        }
    }
});

// --- Dashboard Functions ---

/**
 * Sends the main dashboard embed and components to the user.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 */
async function sendMainDashboard(interaction) {
    const embed = new EmbedBuilder()
        .setTitle("Bot Dashboard")
        .setDescription("Welcome to the bot dashboard! Use the buttons below to manage different features.")
        .setColor("#5865F2");

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("dash:reaction-roles")
            .setLabel("Reaction Roles")
            .setStyle(ButtonStyle.Primary)
    );
    await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });
}

/**
 * Displays the reaction roles dashboard, listing existing menus and providing options to create/configure.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 */
async function showReactionRolesDashboard(interaction) {
    const menus = db.getMenus(interaction.guild.id);

    const embed = new EmbedBuilder()
        .setTitle("Reaction Role Menus")
        .setDescription("Manage your reaction role menus here. Create new ones or configure existing.")
        .setColor("#5865F2");

    const components = [];

    if (menus.length > 0) {
        const menuOptions = menus.map((menu) => ({ label: menu.name, value: menu.id }));
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("rr:selectmenu")
            .setPlaceholder("Select a menu to configure...")
            .addOptions(menuOptions);
        components.push(new ActionRowBuilder().addComponents(selectMenu));
    } else {
        embed.setDescription("No reaction role menus found. Create a new one!");
    }

    const createButton = new ButtonBuilder()
        .setCustomId("rr:create")
        .setLabel("Create New Menu")
        .setStyle(ButtonStyle.Success)
        .setEmoji("➕");

    const backButton = new ButtonBuilder()
        .setCustomId("dash:back")
        .setLabel("Back to Dashboard")
        .setStyle(ButtonStyle.Secondary);

    components.push(new ActionRowBuilder().addComponents(createButton, backButton));

    try {
        await interaction.editReply({ embeds: [embed], components, ephemeral: true });
    } catch (error) {
        console.error("Error displaying reaction roles dashboard:", error);
        await interaction.editReply({ content: "❌ Something went wrong while displaying the reaction roles dashboard.", ephemeral: true });
    }
}

/**
 * Displays the configuration options for a specific reaction role menu.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} menuId - The ID of the menu to configure.
 */
async function showMenuConfiguration(interaction, menuId) {
  if (!menuId || typeof menuId !== 'string' || menuId.length < 5) {
    console.error(`Invalid menuId provided to showMenuConfiguration: ${menuId}`);
    return interaction.editReply({
      content: "❌ Invalid menu configuration. Please recreate the menu or select a valid one from the dashboard.",
      ephemeral: true
    });
  }

  const menu = db.getMenu(menuId);
  if (!menu) {
    console.error(`Menu not found for ID: ${menuId}`);
    return interaction.editReply({ content: "Menu not found. It might have been deleted.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Configuring: ${menu.name}`)
    .setDescription(menu.desc)
    .addFields(
      { name: "Menu ID", value: `\`${menu.id}\``, inline: true },
      { name: "Selection Type", value: menu.selectionType.join(" & ") || "Not set", inline: true },
      { name: "Published", value: menu.messageId ? `✅ Yes in <#${menu.channelId}>` : "❌ No", inline: true },
      { name: "Dropdown Roles", value: menu.dropdownRoles.length > 0 ? menu.dropdownRoles.map((r) => `<@&${r}>`).join(", ") : "None", inline: false },
      { name: "Button Roles", value: menu.buttonRoles.length > 0 ? menu.buttonRoles.map((r) => `<@&${r}>`).join(", ") : "None", inline: false },
    )
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

  // Add webhook status to embed
  embed.addFields(
    {
      name: "Webhook Sending",
      value: menu.useWebhook ? "✅ Enabled" : "❌ Disabled",
      inline: true
    },
    {
      name: "Webhook Branding",
      value: menu.webhookName
        ? `Name: ${menu.webhookName}\n${menu.webhookAvatar ? "Custom Avatar" : "Default Avatar"}`
        : "Not configured",
      inline: true
    }
  );

  // --- Buttons for Publishing and Deleting ---
  const row_publish_delete = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:publish:${menuId}`)
      .setLabel("Publish Menu")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!menu.selectionType.length || (!menu.dropdownRoles.length && !menu.buttonRoles.length)), // Disable if no roles are set
    new ButtonBuilder()
      .setCustomId(`rr:edit_published:${menuId}`)
      .setLabel("Update Published Menu")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!menu.messageId), // Disable if not already published
    new ButtonBuilder()
      .setCustomId(`rr:delete_published:${menuId}`)
      .setLabel("Delete Published Message")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!menu.messageId), // Disable if not already published
    new ButtonBuilder()
      .setCustomId(`rr:delete_menu:${menuId}`)
      .setLabel("Delete This Menu")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("dash:reaction-roles")
      .setLabel("Back to RR Dashboard")
      .setStyle(ButtonStyle.Secondary)
  );

  const row1_role_types = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:type:dropdown:${menuId}`)
      .setLabel("Set Dropdown Roles")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(menu.selectionType.length > 0 && !menu.selectionType.includes("dropdown")),
    new ButtonBuilder()
      .setCustomId(`rr:type:button:${menuId}`)
      .setLabel("Set Button Roles")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(menu.selectionType.length > 0 && !menu.selectionType.includes("button")),
    new ButtonBuilder()
      .setCustomId(`rr:type:both:${menuId}`)
      .setLabel("Set Both Types")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(menu.selectionType.length === 2),
  );

  const row2_emojis_reorder = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:addemoji:dropdown:${menuId}`)
      .setLabel("Add Dropdown Emojis")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!menu.dropdownRoles.length),
    new ButtonBuilder()
      .setCustomId(`rr:addemoji:button:${menuId}`)
      .setLabel("Add Button Emojis")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!menu.buttonRoles.length),
    new ButtonBuilder()
      .setCustomId(`rr:reorder_dropdown:${menuId}`)
      .setLabel("Reorder Dropdown Roles")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(menu.dropdownRoles.length <= 1),
    new ButtonBuilder()
      .setCustomId(`rr:reorder_button:${menuId}`)
      .setLabel("Reorder Button Roles")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(menu.buttonRoles.length <= 1)
  );

  const row3_limits_exclusions_descriptions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:setlimits:${menuId}`)
      .setLabel("Set Regional Limits & Max Roles")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:setexclusions:${menuId}`)
      .setLabel("Set Role Exclusions")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:set_role_descriptions:${menuId}`)
      .setLabel("Set Role Descriptions")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!menu.dropdownRoles.length)
  );

  const row4_customize_messages_webhook = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:customize_embed:${menuId}`)
      .setLabel("Customize Embed")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:customize_footer:${menuId}`)
      .setLabel("Customize Footer")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:custom_messages:${menuId}`)
      .setLabel("Custom Messages")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rr:toggle_webhook:${menuId}`)
      .setLabel(menu.useWebhook ? "Disable Webhook" : "Enable Webhook")
      .setStyle(menu.useWebhook ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rr:config_webhook:${menuId}`)
      .setLabel("Configure Branding")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!menu.useWebhook)
  );

  const row5_clear_buttons_toggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:toggle_dropdown_clear_button:${menuId}:${!menu.enableDropdownClearRolesButton}`)
      .setLabel(`Dropdown Clear: ${menu.enableDropdownClearRolesButton ? '✅ Enabled' : '❌ Disabled'}`)
      .setStyle(menu.enableDropdownClearRolesButton ? ButtonStyle.Success : ButtonStyle.Danger)
      .setDisabled(!menu.selectionType.includes("dropdown")),
    new ButtonBuilder()
      .setCustomId(`rr:toggle_button_clear_button:${menuId}:${!menu.enableButtonClearRolesButton}`)
      .setLabel(`Button Clear: ${menu.enableButtonClearRolesButton ? '✅ Enabled' : '❌ Disabled'}`)
      .setStyle(menu.enableButtonClearRolesButton ? ButtonStyle.Success : ButtonStyle.Danger)
      .setDisabled(!menu.selectionType.includes("button"))
  );

  const allPossibleRows = [
    row_publish_delete,
    row1_role_types,
    row2_emojis_reorder,
    row3_limits_exclusions_descriptions,
    row4_customize_messages_webhook,
    row5_clear_buttons_toggles,
  ];

  const finalComponents = allPossibleRows.filter(row => row.components.length > 0).slice(0, 5); // Max 5 action rows

  try {
    await interaction.editReply({ embeds: [embed], components: finalComponents, ephemeral: true });
  } catch (error) {
    console.error("Error displaying menu configuration:", error);
    await interaction.editReply({ content: "❌ Something went wrong while displaying the menu configuration.", ephemeral: true });
  }
}

/**
 * Publishes a reaction role menu message to a channel, or edits an existing one.
 * @param {import('discord.js').Interaction} interaction - The interaction that triggered the publish.
 * @param {string} menuId - The ID of the menu to publish.
 * @param {import('discord.js').Message} [messageToEdit=null] - An optional existing message to edit instead of sending a new one.
 */
async function publishMenu(interaction, menuId, messageToEdit = null) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

  // Ensure there are roles configured for the selected type(s) before publishing
  if (!menu.selectionType.length || (!menu.dropdownRoles.length && !menu.buttonRoles.length)) {
      return interaction.editReply({ content: "❌ Cannot publish: Please configure at least one role for either dropdown or button type.", ephemeral: true });
  }

  const embed = await createReactionRoleEmbed(interaction.guild, menu);

  const components = [];

  // Dropdown Select Menu
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length > 0) {
    const dropdownOptions = (menu.dropdownRoleOrder.length > 0
      ? menu.dropdownRoleOrder
      : menu.dropdownRoles
    ).map(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return null;
      return {
        label: role.name,
        value: role.id,
        emoji: parseEmoji(menu.dropdownEmojis[role.id]),
        description: menu.dropdownRoleDescriptions[role.id] || undefined,
      };
    }).filter(Boolean); // Filter out any nulls from roles not found

    if (dropdownOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`rr-role-select:${menuId}`)
        .setPlaceholder("Select a role...")
        .setMinValues(0)
        .setMaxValues(dropdownOptions.length)
        .addOptions(dropdownOptions);
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }
  }

  // Clear dropdown roles button
  if (menu.selectionType.includes("dropdown") && menu.enableDropdownClearRolesButton) {
    const clearButton = new ButtonBuilder()
      .setCustomId(`rr-clear-roles:${menuId}:dropdown`)
      .setLabel("Clear All Dropdown Roles")
      .setStyle(ButtonStyle.Secondary);
    components.push(new ActionRowBuilder().addComponents(clearButton));
  }

  // Buttons
  if (menu.selectionType.includes("button") && menu.buttonRoles.length > 0) {
    const buttonRows = [];
    let currentRow = new ActionRowBuilder();
    const orderedButtonRoles = menu.buttonRoleOrder.length > 0
      ? menu.buttonRoleOrder
      : menu.buttonRoles;

    for (const roleId of orderedButtonRoles) {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) continue;

      const button = new ButtonBuilder()
        .setCustomId(`rr-role-button:${menuId}:${role.id}`)
        .setLabel(role.name)
        .setStyle(ButtonStyle.Secondary);

      const parsedEmoji = parseEmoji(menu.buttonEmojis[role.id]);
      if (parsedEmoji) {
        button.setEmoji(parsedEmoji);
      }

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

  // Clear button roles button
  if (menu.selectionType.includes("button") && menu.enableButtonClearRolesButton) {
    const clearButton = new ButtonBuilder()
      .setCustomId(`rr-clear-roles:${menuId}:button`)
      .setLabel("Clear All Button Roles")
      .setStyle(ButtonStyle.Secondary);
    components.push(new ActionRowBuilder().addComponents(clearButton));
  }

  try {
    // If it's a fresh publish (not an edit), attempt to delete the old message if it exists
    if (menu.messageId && !messageToEdit) {
      try {
        const oldChannel = interaction.guild.channels.cache.get(menu.channelId);
        if (oldChannel) {
          const oldMessage = await oldChannel.messages.fetch(menu.messageId);
          await oldMessage.delete();
          console.log(`Deleted old published message for menu ${menuId}.`);
        }
      } catch (error) {
        console.log(`Couldn't delete old message for menu ${menuId}, probably already deleted or not found. Error: ${error.message}`);
      }
    }

    let message;
    if (messageToEdit) {
      // Edit existing message
      if (menu.useWebhook) {
        const webhook = await getOrCreateWebhook(messageToEdit.channel);
        await webhook.editMessage(messageToEdit.id, {
          embeds: [embed],
          components,
          username: menu.webhookName || interaction.guild.me.displayName,
          avatarURL: menu.webhookAvatar || interaction.guild.me.displayAvatarURL(),
        });
        message = messageToEdit; // Keep the same message reference
      } else {
        message = await messageToEdit.edit({
          embeds: [embed],
          components
        });
      }
    } else if (menu.useWebhook) {
      // WEBHOOK MODE: Send new message via webhook
      const webhook = await getOrCreateWebhook(interaction.channel);
      message = await webhook.send({
        embeds: [embed],
        components,
        username: menu.webhookName || interaction.guild.me.displayName,
        avatarURL: menu.webhookAvatar || interaction.guild.me.displayAvatarURL(),
      });
    } else {
      // REGULAR MODE: Send new standard bot message
      message = await interaction.channel.send({
        embeds: [embed],
        components
      });
    }

    await db.saveMessageId(menuId, interaction.channel.id, message.id);
    await interaction.editReply({
      content: `✅ Menu published successfully using ${menu.useWebhook ? "WEBHOOK" : "BOT"}!`,
      ephemeral: true
    });
    // After publishing, update the configuration view to reflect the published status
    return showMenuConfiguration(interaction, menuId);
  } catch (error) {
    console.error("Publishing error:", error);
    let errorMsg = "❌ Failed to publish menu. ";

    if (error.code === 50013) { // Missing Permissions
      errorMsg += "Bot lacks permissions. Required: 'Manage Webhooks' and 'Send Messages' in the channel, and 'Manage Roles' in the guild.";
    } else if (error.message.includes("ENOENT") || error.message.includes("Invalid Form Body")) {
      errorMsg += "Invalid image URL or resource not found, or invalid component data. Please check your embed/webhook settings and role configurations.";
    } else {
      errorMsg += error.message;
    }

    await interaction.editReply({ content: errorMsg, ephemeral: true });
  }
}

client.login(process.env.TOKEN);
