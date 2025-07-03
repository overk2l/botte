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
let firebaseEnabled = false;
let firebaseApp;
let dbFirestore;

try {
  if (process.env.FIREBASE_CONFIG) {
    // Enhanced debugging for Firebase config
    console.log("[Firebase Debug] Raw FIREBASE_CONFIG env var:", process.env.FIREBASE_CONFIG);
    console.log("[Firebase Debug] Type of FIREBASE_CONFIG:", typeof process.env.FIREBASE_CONFIG);
    console.log("[Firebase Debug] Length:", process.env.FIREBASE_CONFIG?.length);
    console.log("[Firebase Debug] First 100 chars:", process.env.FIREBASE_CONFIG?.substring(0, 100));
    console.log("[Firebase Debug] Raw value with quotes:", JSON.stringify(process.env.FIREBASE_CONFIG));
    
    // Check for hidden characters at the beginning
    if (process.env.FIREBASE_CONFIG) {
      console.log("[Firebase Debug] First 5 characters (char codes):");
      for (let i = 0; i < Math.min(5, process.env.FIREBASE_CONFIG.length); i++) {
        const char = process.env.FIREBASE_CONFIG[i];
        console.log(`  [${i}]: '${char}' (code: ${char.charCodeAt(0)})`);
      }
    }
    
    // Trim any leading/trailing whitespace or invisible characters that might cause JSON parsing errors
    const rawConfig = process.env.FIREBASE_CONFIG.trim();
    
    // Additional cleaning: remove any potential BOM or zero-width characters
    const cleanedConfig = rawConfig.replace(/^\uFEFF/, '').replace(/^[\u200B-\u200D\uFEFF]/g, '');
    
    try {
      firebaseConfig = JSON.parse(cleanedConfig);
      console.log("[Firebase Debug] Successfully parsed firebaseConfig:", firebaseConfig);
      
      // Ensure projectId exists and is a non-empty string
      if (typeof firebaseConfig.projectId === 'string' && firebaseConfig.projectId && firebaseConfig.projectId !== 'missing-project-id') {
        firebaseApp = initializeApp(firebaseConfig);
        dbFirestore = getFirestore(firebaseApp);
        firebaseEnabled = true;
        console.log("[Firebase] Successfully initialized with project:", firebaseConfig.projectId);
      } else {
        console.warn("[Firebase] Invalid FIREBASE_CONFIG.projectId. Running without persistence.");
      }
    } catch (parseError) {
      console.error("[Firebase] JSON Parse Error:", parseError.message);
      console.error("[Firebase] Failed to parse config string:", cleanedConfig.substring(0, 200), "...");
      console.warn("[Firebase] Running without persistence due to JSON parse error.");
    }
  } else {
    console.warn("[Firebase] FIREBASE_CONFIG environment variable not set. Running without persistence.");
  }
} catch (e) {
  console.error("[Firebase] Error initializing:", e);
  console.warn("[Firebase] Running without persistence.");
}

/**
 * Helper function to get or create a webhook for a given channel.
 * This is used for sending messages with custom branding.
 * @param {import('discord.js').TextChannel} channel - The channel to get/create the webhook in.
 * @param {string} [name="Role Menu Webhook"] - The desired name for the webhook.
 * @returns {Promise<import('discord.js').Webhook>} The webhook instance.
 */
async function getOrCreateWebhook(channel, name = "Role Menu Webhook") {
  if (!channel || !channel.isTextBased()) {
    throw new Error("Invalid channel provided to getOrCreateWebhook");
  }

  try {
    const webhooks = await channel.fetchWebhooks();
    const existing = webhooks.find(w => w.owner && w.owner.id === channel.client.user.id);

    if (existing) return existing;
    
    return await channel.createWebhook({
      name,
      avatar: channel.client.user.displayAvatarURL(),
      reason: "For role menus with custom branding"
    });
  } catch (error) {
    console.error("Error in getOrCreateWebhook:", error);
    throw error;
  }
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
    console.log("[Database] Loading all menus...");
    if (!firebaseEnabled) {
      console.warn("[Database] Running in memory-only mode. Data will not persist between restarts.");
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
      console.log(`[Database] Loaded ${this.menuData.size} menus from Firestore.`);
    } catch (error) {
      console.error("[Database] Error loading menus:", error);
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
      buttonColors: {}, // roleId -> ButtonStyle (Primary, Secondary, Success, Danger)
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
      showMemberCounts: false, // Show member counts on buttons/dropdowns
      buttonColors: {}, // roleId -> ButtonStyle string
      isTemplate: false, // Whether this menu is saved as a template
      templateName: null, // Name for the template
      templateDescription: null, // Description of what this template is for
    };

    // Save to in-memory storage
    if (!this.menus.has(guildId)) {
      this.menus.set(guildId, []);
    }
    this.menus.get(guildId).push(id);
    this.menuData.set(id, newMenu);

    // Save to Firestore if enabled
    if (firebaseEnabled) {
      try {
        const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, id);
        await setDoc(menuDocRef, newMenu);
        console.log(`[Database] Created new menu with ID: ${id} (saved to Firestore)`);
      } catch (error) {
        console.error("[Database] Error saving menu to Firestore:", error);
        // Continue with in-memory storage only
      }
    } else {
      console.log(`[Database] Created new menu with ID: ${id} (memory only)`);
    }

    return id;
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
   * Retrieves all menu IDs currently loaded in memory.
   * This is a helper for debugging.
   * @returns {string[]} An array of all menu IDs.
   */
  getAllMenuIds() {
    return Array.from(this.menuData.keys());
  },

  /**
   * Updates an existing menu's data in both memory and Firestore.
   * @param {string} menuId - The ID of the menu to update.
   * @param {Object} data - The partial data object to merge into the existing menu.
   */
  async updateMenu(menuId, data) {
    if (!menuId || typeof menuId !== 'string') {
      console.warn(`[Database] Invalid menuId provided to updateMenu: ${menuId}`);
      return;
    }

    const menu = this.menuData.get(menuId);
    if (!menu) {
      console.warn(`[Database] Attempted to update non-existent menu: ${menuId}`);
      return;
    }
    
    // Validate data parameter
    if (!data || typeof data !== 'object') {
      console.warn(`[Database] Invalid data provided to updateMenu for menu ${menuId}`);
      return;
    }

    Object.assign(menu, data); // Update in-memory map

    if (firebaseEnabled) {
      try {
        const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, menuId);
        await setDoc(menuDocRef, menu, { merge: true }); // Use merge: true to prevent overwriting fields not in `data`
        console.log(`[Database] Updated menu with ID: ${menuId}`);
      } catch (error) {
        console.error(`[Database] Error updating menu ${menuId} in Firestore:`, error);
        // Continue with in-memory update only
      }
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
    const currentEmojisKey = type === "dropdown" ? "dropdownEmojis" : "buttonEmojis";
    const currentEmojis = menu[currentEmojisKey] || {};
    const updatedEmojis = { ...currentEmojis, ...emojis };
    
    await this.updateMenu(menuId, { [currentEmojisKey]: updatedEmojis });
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
   * Saves button colors for roles within a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {Object} colors - An object mapping role IDs to ButtonStyle strings.
   */
  async saveButtonColors(menuId, colors) {
    const menu = this.menuData.get(menuId);
    if (!menu) return;
    const currentColors = menu.buttonColors || {};
    const updatedColors = { ...currentColors, ...colors };
    
    await this.updateMenu(menuId, { buttonColors: updatedColors });
  },

  /**
   * Saves member count display setting for a menu.
   * @param {string} menuId - The ID of the menu.
   * @param {boolean} showCounts - Whether to show member counts.
   */
  async saveMemberCountSetting(menuId, showCounts) {
    await this.updateMenu(menuId, { showMemberCounts: showCounts });
  },

  /**
   * Saves a menu as a template.
   * @param {string} menuId - The ID of the menu.
   * @param {string} templateName - The name for the template.
   * @param {string} templateDescription - Description of the template.
   */
  async saveAsTemplate(menuId, templateName, templateDescription) {
    await this.updateMenu(menuId, { 
      isTemplate: true, 
      templateName, 
      templateDescription 
    });
  },

  /**
   * Creates a new menu from a template.
   * @param {string} templateId - The ID of the template menu.
   * @param {string} guildId - The ID of the guild where the new menu is created.
   * @param {string} newName - The name for the new menu.
   * @param {string} newDesc - The description for the new menu.
   * @returns {Promise<string>} The ID of the newly created menu.
   */
  async createFromTemplate(templateId, guildId, newName, newDesc) {
    const template = this.getMenu(templateId);
    if (!template) throw new Error("Template not found");
    
    const newMenuId = Date.now().toString() + Math.floor(Math.random() * 1000).toString();
    const newMenu = {
      ...template,
      guildId,
      name: newName,
      desc: newDesc,
      isTemplate: false,
      templateName: null,
      templateDescription: null,
      channelId: null,
      messageId: null
    };

    // Save to in-memory storage
    if (!this.menus.has(guildId)) {
      this.menus.set(guildId, []);
    }
    this.menus.get(guildId).push(newMenuId);
    this.menuData.set(newMenuId, newMenu);

    // Save to Firestore if enabled
    if (firebaseEnabled) {
      try {
        const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, newMenuId);
        await setDoc(menuDocRef, newMenu);
        console.log(`[Database] Created menu from template with ID: ${newMenuId}`);
      } catch (error) {
        console.error("[Database] Error saving template-based menu to Firestore:", error);
      }
    }

    return newMenuId;
  },

  /**
   * Gets all template menus.
   * @returns {Array<Object>} An array of template menu objects.
   */
  getTemplates() {
    return Array.from(this.menuData.entries())
      .filter(([id, menu]) => menu.isTemplate)
      .map(([id, menu]) => ({ id, ...menu }));
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
    if (!menuId || typeof menuId !== 'string') {
      console.warn(`[Database] Invalid menuId provided to deleteMenu: ${menuId}`);
      return;
    }

    const menu = this.menuData.get(menuId);
    if (!menu) {
      console.warn(`[Database] Attempted to delete non-existent menu: ${menuId}`);
      return;
    }

    // Remove from in-memory maps
    const guildMenus = this.menus.get(menu.guildId);
    if (guildMenus) {
      const index = guildMenus.indexOf(menuId);
      if (index > -1) {
        guildMenus.splice(index, 1);
      }
      // Clean up empty guild arrays
      if (guildMenus.length === 0) {
        this.menus.delete(menu.guildId);
      }
    }
    this.menuData.delete(menuId);

    // Clear any pending timeouts for this menu
    if (menu.messageId && ephemeralTimeouts.has(menu.messageId)) {
      clearTimeout(ephemeralTimeouts.get(menu.messageId));
      ephemeralTimeouts.delete(menu.messageId);
    }

    if (firebaseEnabled) {
      try {
        // Delete from Firestore
        const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, menuId);
        await deleteDoc(menuDocRef);
        console.log(`[Database] Deleted menu with ID: ${menuId} from Firestore`);
      } catch (error) {
        console.error(`[Database] Error deleting menu ${menuId} in Firestore:`, error);
        // Continue with in-memory deletion only
      }
    } else {
      console.log(`[Database] Deleted menu with ID: ${menuId} (memory only)`);
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
  
  // For unicode emojis, we'll assume short strings (1-4 characters)
  // are intended as direct unicode emojis. This is a heuristic to prevent
  // passing arbitrary long strings as emoji names, which Discord's API might reject.
  if (emoji.length > 0 && emoji.length <= 4) {
      return { name: emoji };
  }

  // If it's not a custom emoji and not a short string (potential unicode emoji), return undefined.
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
        .setTitle(menu.name) // Uses menu.name for title
        .setDescription(menu.desc) // Uses menu.desc for description
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

// Map to store timeout references for cleanup
const ephemeralTimeouts = new Map();

// Simple rate limiting for role interactions
const roleInteractionCooldowns = new Map();
const ROLE_INTERACTION_COOLDOWN = 3000; // 3 seconds cooldown

/**
 * Checks if a user is on cooldown for role interactions
 * @param {string} userId - The user ID
 * @returns {boolean} True if user is on cooldown
 */
function isOnRoleInteractionCooldown(userId) {
    const now = Date.now();
    const lastInteraction = roleInteractionCooldowns.get(userId);
    
    if (!lastInteraction) return false;
    
    const timeSinceLastInteraction = now - lastInteraction;
    if (timeSinceLastInteraction < ROLE_INTERACTION_COOLDOWN) {
        return true;
    }
    
    // Clean up old entries
    if (timeSinceLastInteraction > ROLE_INTERACTION_COOLDOWN * 2) {
        roleInteractionCooldowns.delete(userId);
    }
    
    return false;
}

/**
 * Sets a user's last role interaction time
 * @param {string} userId - The user ID
 */
function setRoleInteractionCooldown(userId) {
    roleInteractionCooldowns.set(userId, Date.now());
}

/**
 * Helper function to send a rich embed notification for role changes.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string[]} addedRoles - Array of role IDs that were added.
 * @param {string[]} removedRoles - Array of role IDs that were removed.
 * @param {import('discord.js').GuildMember} member - The member whose roles changed.
 * @param {boolean} [autoDelete=true] - Whether to auto-delete the message after 6 seconds.
 * @returns {Promise<import('discord.js').Message>} The sent message.
 */
async function sendRoleChangeNotification(interaction, addedRoles, removedRoles, member, autoDelete = true) {
    if (!interaction || (!addedRoles.length && !removedRoles.length)) {
        return;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: member.displayName,
            iconURL: member.user.displayAvatarURL({ dynamic: true })
        })
        .setTimestamp()
        .setFooter({
            text: "Role Update",
            iconURL: interaction.client.user.displayAvatarURL({ dynamic: true })
        });

    // Build description based on role changes
    let description = "";
    let color = "#5865F2"; // Default Discord blurple

    if (addedRoles.length > 0) {
        const addedRoleNames = addedRoles.map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            return role ? `<@&${roleId}>` : 'Unknown Role';
        });
        
        description += `**✅ Roles Added:**\n${addedRoleNames.join('\n')}\n\n`;
        color = "#00FF00"; // Green for additions
    }

    if (removedRoles.length > 0) {
        const removedRoleNames = removedRoles.map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            return role ? `<@&${roleId}>` : 'Unknown Role';
        });
        
        description += `**❌ Roles Removed:**\n${removedRoleNames.join('\n')}`;
        color = addedRoles.length > 0 ? "#FFFF00" : "#FF6B6B"; // Yellow for mixed, red for only removals
    }

    embed.setDescription(description.trim()).setColor(color);

    let message;
    try {
        // Check if interaction has already been replied/deferred
        if (interaction.replied || interaction.deferred) {
            message = await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral, components: [] });
        } else {
            message = await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    } catch (error) {
        console.error("Error sending role change notification:", error);
        // Fallback to followUp
        try {
            message = await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (followUpError) {
            console.error("Error sending follow-up role notification:", followUpError);
            return;
        }
    }

    // Auto-delete the ephemeral message after 6 seconds if autoDelete is true
    if (message && autoDelete) {
        const timeoutId = setTimeout(async () => {
            try {
                // For ephemeral messages, we can't fetch them, so just try to delete
                await interaction.deleteReply().catch(() => {
                    // Silently fail if already deleted
                });
            } catch (e) {
                // Silently fail if message is already deleted or no permission
            }
            
            // Clean up timeout reference
            if (ephemeralTimeouts.has(interaction.id)) {
                ephemeralTimeouts.delete(interaction.id);
            }
        }, 6000);

        // Store timeout reference
        ephemeralTimeouts.set(interaction.id, timeoutId);
    }

    return message;
}

/**
 * Sends an ephemeral embed reply or follow-up to an interaction.
 * The message will be automatically deleted after 6 seconds if autoDelete is true.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} description - The description for the embed.
 * @param {string} [color="#5865F2"] - The color of the embed (hex code).
 * @param {string} [title="Notification"] - The title of the embed.
 * @param {boolean} [autoDelete=true] - Whether the message should be auto-deleted after 6 seconds.
 */
async function sendEphemeralEmbed(interaction, description, color = "#5865F2", title = "Notification", autoDelete = true) {
    if (!interaction || !description) {
        console.error("Invalid parameters for sendEphemeralEmbed");
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);
    
    let message;
    try {
        // Check if interaction has already been replied/deferred
        if (interaction.replied || interaction.deferred) {
            message = await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral, components: [] });
        } else {
            message = await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    } catch (error) {
        console.error("Error sending ephemeral embed:", error);
        // Try followUp as last resort
        try {
            message = await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (followUpError) {
            console.error("Error sending follow-up:", followUpError);
            return; // Cannot send message, so nothing to delete
        }
    }

    // Auto-delete the ephemeral message after 6 seconds if autoDelete is true
    if (message && autoDelete) {
        const timeoutId = setTimeout(async () => {
            try {
                // If it was an initial reply, use deleteReply() on the interaction
                if (interaction.replied || interaction.deferred) {
                    // For ephemeral messages, we can't fetch them, so just try to delete
                    await interaction.deleteReply().catch(() => {
                        // Silently fail if already deleted
                    });
                } else {
                    // If it was a followUp, delete the message directly
                    await message.delete().catch(() => {
                        // Silently fail if already deleted
                    });
                }
            } catch (deleteError) {
                // Ignore "Unknown Message" error (10008) if the user already dismissed it
                if (deleteError.code !== 10008) {
                    console.error("Error auto-deleting ephemeral message:", deleteError);
                }
            } finally {
                // Clean up timeout reference
                ephemeralTimeouts.delete(message.id);
            }
        }, 6000); // 6000 milliseconds = 6 seconds
        
        // Store timeout reference for potential cleanup
        ephemeralTimeouts.set(message.id, timeoutId);
    }

    return message;
}


/**
 * Updates the components (dropdowns and buttons) on a published reaction role message
 * to reflect the current roles held by the interacting member.
 * This is crucial for keeping the UI in sync with the user's state.
 * @param {import('discord.js').Interaction} interaction - The interaction that triggered the update.
 * @param {Object} menu - The menu object.
 * @param {string} menuId - The ID of the menu.
 */
async function updatePublishedMessageComponents(interaction, menu, menuId) {
    if (!menu || !menu.channelId || !menu.messageId) {
        console.warn(`[updatePublishedMessageComponents] Invalid menu or missing channel/message ID for menu ${menuId}`);
        return;
    }

    if (!interaction || !interaction.guild) {
        console.warn(`[updatePublishedMessageComponents] Invalid interaction for menu ${menuId}`);
        return;
    }

    const guild = interaction.guild;

    try {
        const originalChannel = await guild.channels.fetch(menu.channelId).catch(() => null);
        if (!originalChannel || !originalChannel.isTextBased()) {
            console.error(`Channel ${menu.channelId} not found or not text-based for menu ${menuId}`);
            await db.clearMessageId(menuId);
            return;
        }

        const originalMessage = await originalChannel.messages.fetch(menu.messageId).catch(() => null);
        if (!originalMessage) {
            console.error(`Message ${menu.messageId} not found for menu ${menuId}`);
            await db.clearMessageId(menuId);
            return;
        }

        const components = [];

        // Rebuild Dropdown Select Menu
        if (menu.selectionType.includes("dropdown") && (menu.dropdownRoles && menu.dropdownRoles.length > 0)) {
            const dropdownOptions = (menu.dropdownRoleOrder.length > 0
                ? menu.dropdownRoleOrder
                : menu.dropdownRoles
            ).map(roleId => {
                const role = guild.roles.cache.get(roleId);
                if (!role) {
                    console.warn(`Role ${roleId} not found in guild for menu ${menuId}`);
                    return null;
                }
                
                // Get member count if enabled
                const memberCount = menu.showMemberCounts ? role.members.size : null;
                const labelText = memberCount !== null 
                    ? `${role.name} (${memberCount})` 
                    : role.name;
                
                return {
                    label: labelText.substring(0, 100),
                    value: role.id,
                    emoji: parseEmoji(menu.dropdownEmojis[role.id]),
                    description: menu.dropdownRoleDescriptions[role.id] ? menu.dropdownRoleDescriptions[role.id].substring(0, 100) : undefined,
                    default: false // Always set default to false so roles are not pre-selected
                };
            }).filter(Boolean);

            if (dropdownOptions.length > 0) {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`rr-role-select:${menuId}`)
                    .setPlaceholder("Select roles to toggle...")
                    .setMinValues(1)
                    .setMaxValues(dropdownOptions.length)
                    .addOptions(dropdownOptions);
                components.push(new ActionRowBuilder().addComponents(selectMenu));
            }
        }

        // Rebuild Buttons
        if (menu.selectionType.includes("button") && (menu.buttonRoles && menu.buttonRoles.length > 0)) {
            const buttonRows = [];
            let currentRow = new ActionRowBuilder();
            const orderedButtonRoles = menu.buttonRoleOrder.length > 0
                ? menu.buttonRoleOrder
                : menu.buttonRoles;

            for (const roleId of orderedButtonRoles) {
                const role = guild.roles.cache.get(roleId);
                if (!role) {
                    console.warn(`Button role ${roleId} not found in guild for menu ${menuId}`);
                    continue;
                }

                // Get member count if enabled
                const memberCount = menu.showMemberCounts ? role.members.size : null;
                const labelText = memberCount !== null 
                    ? `${role.name} (${memberCount})` 
                    : role.name;

                // Get custom button color or default to secondary
                const buttonColorName = menu.buttonColors?.[role.id] || 'Secondary';
                const buttonStyle = ButtonStyle[buttonColorName] || ButtonStyle.Secondary;

                const button = new ButtonBuilder()
                    .setCustomId(`rr-role-button:${menuId}:${role.id}`)
                    .setLabel(labelText.substring(0, 80))
                    .setStyle(buttonStyle);

                // Only set emoji if parseEmoji returns a valid object
                const parsedEmoji = parseEmoji(menu.buttonEmojis[role.id]);
                if (parsedEmoji) {
                    button.setEmoji(parsedEmoji);
                }

                if (currentRow.components.length < 5) {
                    currentRow.addComponents(button);
                } else {
                    buttonRows.push(currentRow);
                    currentRow = new ActionRowBuilder().addComponents(button);
                    if (buttonRows.length >= 4) break; // Discord limit
                }
            }
            if (currentRow.components.length > 0 && buttonRows.length < 4) {
                buttonRows.push(currentRow);
            }
            components.push(...buttonRows);
        }

        const publishedEmbed = await createReactionRoleEmbed(guild, menu);

        // Edit the message
        if (menu.useWebhook) {
            try {
                const webhook = await getOrCreateWebhook(originalChannel);
                await webhook.editMessage(originalMessage.id, {
                    embeds: [publishedEmbed],
                    components,
                    username: menu.webhookName || client.user.displayName,
                    avatarURL: menu.webhookAvatar || client.user.displayAvatarURL(),
                });
            } catch (webhookError) {
                console.error("Error updating via webhook:", webhookError);
                // Fallback to regular bot message edit
                await originalMessage.edit({ embeds: [publishedEmbed], components });
            }
        } else {
            await originalMessage.edit({ embeds: [publishedEmbed], components });
        }

    } catch (error) {
        console.error("Error updating published message components:", error);
        // If the message or channel is gone, clear the message ID from the menu
        if (error.code === 10003 || error.code === 50001 || error.code === 10008) { // Unknown Channel, Missing Access, or Unknown Message
            console.log(`Clearing message ID for menu ${menuId} due to channel/message access error.`);
            await db.clearMessageId(menuId);
        }
    }
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildWebhooks,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // Load all menus from Firestore when the bot starts
  await db.loadAllMenus();

  const rest = new REST().setToken(process.env.TOKEN);
  const cmd = new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Open the guild dashboard")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator) // Add this to make it admin-only by default
    .toJSON();
  
  try {
    if (process.env.GUILD_ID) {
      // Deploy to specific guild for development
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
      console.log("✅ /dashboard command deployed to guild.");
    } else {
      // Deploy globally
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [cmd] });
      console.log("✅ /dashboard command deployed globally.");
    }
  } catch (error) {
    console.error("Error deploying slash command:", error);
  }
});

// Cleanup function for graceful shutdown
function cleanup() {
  console.log("🧹 Cleaning up resources...");
  
  // Clear all pending timeouts
  for (const [messageId, timeoutId] of ephemeralTimeouts) {
    clearTimeout(timeoutId);
  }
  ephemeralTimeouts.clear();
  
  // Clear cooldown maps
  roleInteractionCooldowns.clear();
  
  // Clear database maps
  db.menus.clear();
  db.menuData.clear();
  
  console.log("✅ Cleanup completed");
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log("📴 Received SIGINT, shutting down gracefully...");
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log("📴 Received SIGTERM, shutting down gracefully...");
  cleanup();
  process.exit(0);
});

client.on("interactionCreate", async (interaction) => {
  // Early return for DMs
  if (!interaction.guild) {
    if (interaction.isCommand() || interaction.isButton() || interaction.isStringSelectMenu()) {
      return interaction.reply({ content: "This bot can only be used in servers.", ephemeral: true });
    }
    return;
  }

  // Defer reply for most interactions to prevent timeout,
  // EXCEPT for interactions that immediately show a modal.
  const isModalTrigger = (
    (interaction.isButton() && interaction.customId === "rr:create") ||
    (interaction.isButton() && interaction.customId.startsWith("rr:addemoji:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:setlimits:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:customize_embed:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:customize_footer:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:custom_messages:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:config_webhook:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:reorder_dropdown:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:reorder_button:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:configure_button_colors:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:save_as_template:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr:clone_menu:")) ||
    (interaction.isButton() && interaction.customId === "rr:prompt_raw_embed_json") ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:select_role_for_description:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:select_template"))
  );

  // Check if it's a modal submission - these need deferUpdate
  const isModalSubmission = interaction.isModalSubmit();

  // Defer non-modal-trigger interactions
  if (!interaction.replied && !interaction.deferred && !isModalTrigger && !isModalSubmission) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error("Error deferring reply:", e);
    }
  }

  try {
    // Show Firebase warning only once per interaction for admin commands
    if (!firebaseEnabled && interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const relevantInteraction = (
        (interaction.isChatInputCommand() && interaction.commandName === "dashboard") ||
        (interaction.customId?.startsWith("rr:") && !interaction.customId.startsWith("rr-role-"))
      );
      
      // Only send if it's a relevant admin interaction. sendEphemeralEmbed handles defer/reply logic.
      if (relevantInteraction) {
        await sendEphemeralEmbed(
          interaction,
          "⚠️ **WARNING: FIREBASE IS NOT CONFIGURED!** Your bot's data (menus, roles, etc.) will **NOT** persist between restarts. To enable persistence, please set the `FIREBASE_CONFIG` environment variable with a valid Firebase configuration. If you're seeing 'menu no longer valid' errors, this is likely the cause.",
          "#FFA500", // Orange color for warning
          "Firebase Configuration Warning",
          false // Do not auto-delete this admin warning
        );
      }
    }

    // Slash Command Handling
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "dashboard") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.editReply({ content: "❌ You need Administrator permissions to use the dashboard.", flags: MessageFlags.Ephemeral });
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

      if (ctx === "dash") {
        if (action === "reaction-roles") return showReactionRolesDashboard(interaction);
        if (action === "interactive-menus") return showInteractiveMenusDashboard(interaction);
        if (action === "back") return sendMainDashboard(interaction);
      }

      if (ctx === "im") {
        // All interactive menu buttons require admin permissions
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.editReply({ content: "❌ You need Administrator permissions to configure interactive menus.", flags: MessageFlags.Ephemeral });
        }

        // Parse menu ID for actions that need it
        if (["add_page", "edit_pages", "preview", "publish", "customize", "settings", "delete", "confirm_delete", "cancel_delete"].includes(action)) {
          menuId = parts[2];
        }

        if (action === "create") {
          const modal = new ModalBuilder()
            .setCustomId("im:modal:create")
            .setTitle("New Interactive Menu")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("name")
                  .setLabel("Menu Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Enter menu name (e.g., 'Server Guide')")
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("description")
                  .setLabel("Menu Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder("Describe what this interactive menu is for")
                  .setMaxLength(1000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "add_page") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          
          const modal = new ModalBuilder()
            .setCustomId(`im:modal:add_page:${menuId}`)
            .setTitle("Add New Page")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("title")
                  .setLabel("Page Title")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Enter page title")
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("content")
                  .setLabel("Page Content")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder("Enter the content for this page")
                  .setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "edit_pages") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          return interaction.editReply({ 
            content: "📝 **Page editing is coming soon!** For now, you can add new pages and preview your menu.", 
            flags: MessageFlags.Ephemeral 
          });
        }

        if (action === "preview") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getInteractiveMenu(menuId);
          if (!menu) {
            return interaction.editReply({ content: "❌ Menu not found.", flags: MessageFlags.Ephemeral });
          }
          if (!menu.pages?.length) {
            return interaction.editReply({ content: "❌ This menu has no pages to preview.", flags: MessageFlags.Ephemeral });
          }
          return interaction.editReply({ 
            content: "👀 **Preview feature is coming soon!** You'll be able to test your interactive menu before publishing.", 
            flags: MessageFlags.Ephemeral 
          });
        }

        if (action === "publish") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getInteractiveMenu(menuId);
          if (!menu) {
            return interaction.editReply({ content: "❌ Menu not found.", flags: MessageFlags.Ephemeral });
          }
          if (!menu.pages?.length) {
            return interaction.editReply({ content: "❌ Cannot publish a menu with no pages.", flags: MessageFlags.Ephemeral });
          }
          return interaction.editReply({ 
            content: "🚀 **Publishing feature is coming soon!** You'll be able to publish your interactive menu to any channel.", 
            flags: MessageFlags.Ephemeral 
          });
        }

        if (action === "customize") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          return interaction.editReply({ 
            content: "🎨 **Customization options are coming soon!** You'll be able to customize colors, thumbnails, and more.", 
            flags: MessageFlags.Ephemeral 
          });
        }

        if (action === "settings") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          return interaction.editReply({ 
            content: "⚙️ **Settings panel is coming soon!** You'll be able to configure permissions, auto-delete, and other options.", 
            flags: MessageFlags.Ephemeral 
          });
        }

        if (action === "delete") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          
          const confirmButton = new ButtonBuilder()
            .setCustomId(`im:confirm_delete:${menuId}`)
            .setLabel("Confirm Delete")
            .setStyle(ButtonStyle.Danger);
          const cancelButton = new ButtonBuilder()
            .setCustomId(`im:cancel_delete:${menuId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary);
          const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

          return interaction.editReply({
            content: "⚠️ Are you sure you want to delete this interactive menu? This will remove all its pages and content permanently.",
            components: [row],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "confirm_delete") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], flags: MessageFlags.Ephemeral });
          
          const menu = db.getInteractiveMenu(menuId);
          if (!menu) {
            return interaction.editReply({ content: "❌ Menu not found or already deleted.", components: [], flags: MessageFlags.Ephemeral });
          }

          try {
            await db.deleteInteractiveMenu(menuId);
            await interaction.editReply({
              content: "✅ Interactive menu deleted successfully!",
              components: [],
              flags: MessageFlags.Ephemeral
            });
            return showInteractiveMenusDashboard(interaction);
          } catch (error) {
            console.error("Error deleting interactive menu:", error);
            return interaction.editReply({
              content: `❌ Failed to delete menu: ${error.message}`,
              components: [],
              flags: MessageFlags.Ephemeral
            });
          }
        }

        if (action === "cancel_delete") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], flags: MessageFlags.Ephemeral });
          return showInteractiveMenuConfiguration(interaction, menuId);
        }
      }

      if (ctx === "rr") {
        // All dashboard-related buttons should also have a permission check
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.editReply({ content: "❌ You need Administrator permissions to configure reaction roles.", flags: MessageFlags.Ephemeral });
        }

        // Assign menuId, type based on action within the rr context
        if (action === "create") {
          // No menuId needed yet, it's created in the modal submit
        } else if (["publish", "edit_published", "delete_published", "confirm_delete_published", "cancel_delete_published", "setlimits", "setexclusions", "customize_embed", "customize_footer", "toggle_webhook", "config_webhook", "delete_menu", "confirm_delete_menu", "cancel_delete_menu", "custom_messages", "prompt_role_description_select", "prompt_raw_embed_json", "toggle_member_counts", "configure_button_colors", "save_as_template", "clone_menu", "browse_templates"].includes(action)) {
          menuId = parts[2]; // For these actions, menuId is parts[2]
        } else if (["type", "addemoji", "manage_roles", "toggle_type"].includes(action)) {
          type = parts[2]; // 'dropdown', 'button'
          menuId = parts[3]; // For these actions, menuId is parts[3]
        } else if (["reorder_dropdown", "reorder_button"].includes(action)) {
          type = action.split("_")[1]; // 'dropdown' or 'button'
          menuId = parts[2];
        }

        if (action === "create") {
          const modal = new ModalBuilder()
            .setCustomId("rr:modal:create")
            .setTitle("New Reaction Role Menu")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("name").setLabel("Menu Name").setStyle(TextInputStyle.Short).setRequired(true)
                  .setPlaceholder("Enter menu name (e.g., 'Game Roles')")
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("desc").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(true)
                  .setPlaceholder("Describe your menu here.")
                  .setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "publish") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing for publish.", flags: MessageFlags.Ephemeral });
          return publishMenu(interaction, menuId);
        }

        if (action === "edit_published") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return interaction.editReply({ content: "❌ No published message found for this menu to edit.", flags: MessageFlags.Ephemeral });
          }
          const channel = interaction.guild.channels.cache.get(menu.channelId);
          if (!channel) return interaction.editReply({ content: "❌ Published channel not found.", flags: MessageFlags.Ephemeral });

          try {
            const message = await channel.messages.fetch(menu.messageId);
            return publishMenu(interaction, menuId, message); // Pass the fetched message to edit
          } catch (error) {
            console.error("Error fetching message to edit:", error);
            return interaction.editReply({ content: "❌ Failed to fetch published message. It might have been deleted manually.", flags: MessageFlags.Ephemeral });
          }
        }

        if (action === "delete_published") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return interaction.editReply({ content: "❌ No published message found for this menu to delete.", flags: MessageFlags.Ephemeral });
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
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "confirm_delete_published") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return interaction.editReply({ content: "❌ No published message found or already deleted.", components: [], flags: MessageFlags.Ephemeral });
          }
          const channel = interaction.guild.channels.cache.get(menu.channelId);
          if (!channel) {
            await db.clearMessageId(menuId); // Clear ID even if channel is gone
            return interaction.editReply({ content: "❌ Published channel not found. Message ID cleared.", flags: MessageFlags.Ephemeral });
          }

          try {
            const message = await channel.messages.fetch(menu.messageId);
            await message.delete();
            await db.clearMessageId(menuId); // Clear message ID from the menu in DB
            await interaction.editReply({
              content: "✅ Published message deleted successfully!",
              components: [],
              flags: MessageFlags.Ephemeral
            });
            return showMenuConfiguration(interaction, menuId); // Refresh the menu config view
          } catch (error) {
            console.error("Error deleting message:", error);
            await db.clearMessageId(menuId); // Clear ID if deletion fails (e.g., message already deleted)
            return interaction.editReply({
              content: "❌ Failed to delete message. It might have already been deleted manually. Message ID cleared.",
              flags: MessageFlags.Ephemeral
            });
          }
        }

        if (action === "cancel_delete_published") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], flags: MessageFlags.Ephemeral });
          return interaction.editReply({ content: "Deletion cancelled.", components: [], flags: MessageFlags.Ephemeral });
        }

        if (action === "delete_menu") {
            if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
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
                flags: MessageFlags.Ephemeral
            });
        }

        if (action === "confirm_delete_menu") {
            if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], flags: MessageFlags.Ephemeral });
            const menu = db.getMenu(menuId);
            if (!menu) {
                return interaction.editReply({ content: "❌ Menu not found or already deleted.", components: [], flags: MessageFlags.Ephemeral });
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
                    flags: MessageFlags.Ephemeral
                });
                return showReactionRolesDashboard(interaction); // Go back to the main RR dashboard
            } catch (error) {
                console.error("Error deleting menu:", error);
                return interaction.editReply({
                    content: `❌ Failed to delete menu: ${error.message}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (action === "cancel_delete_menu") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", components: [], flags: MessageFlags.Ephemeral });
          return interaction.editReply({ content: "Deletion cancelled.", components: [], flags: MessageFlags.Ephemeral });
        }

        if (action === "toggle_type") { 
          if (!menuId || !type) return interaction.editReply({ content: "Menu ID or type missing.", flags: MessageFlags.Ephemeral });
          
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const currentSelectionTypes = new Set(menu.selectionType || []);
          const typeEnabled = currentSelectionTypes.has(type);

          if (typeEnabled) {
            // If type is currently enabled, disable it and clear associated roles/emojis/order
            currentSelectionTypes.delete(type);
            await db.saveSelectionType(menuId, Array.from(currentSelectionTypes));
            await db.saveRoles(menuId, [], type); // Clear roles
            await db.saveEmojis(menuId, {}, type); // Clear emojis
            await db.saveRoleOrder(menuId, [], type); // Clear order
            await sendEphemeralEmbed(interaction, `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} roles disabled and cleared.`, "#00FF00", "Success", false);
            return showMenuConfiguration(interaction, menuId);
          } else {
            // If type is currently disabled, enable it and prompt to manage roles
            currentSelectionTypes.add(type);
            await db.saveSelectionType(menuId, Array.from(currentSelectionTypes));
            await sendEphemeralEmbed(interaction, `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} roles enabled. Now select roles.`, "#00FF00", "Success", false);
            return promptManageRoles(interaction, menuId, type);
          }
        }

        if (action === "addemoji") {
          if (!menuId || !type) return interaction.editReply({ content: "Menu ID or type missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const modal = new ModalBuilder().setCustomId(`rr:modal:addemoji:${type}:${menuId}`).setTitle(`Add Emojis for ${type}`);

          const roles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
          if (roles.length === 0) {
            return interaction.editReply({ content: `No roles configured for ${type} menu. Add roles first.`, flags: MessageFlags.Ephemeral });
          }

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
                  .setValue(String(currentEmoji))
              )
            );
          }
          return interaction.showModal(modal);
        }

        if (action === "reorder_dropdown" || action === "reorder_button") {
          type = action.split("_")[1];
          menuId = parts[2];
          
          const menu = db.getMenu(menuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const actualRoles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
          const currentOrder = type === "dropdown" 
            ? (menu.dropdownRoleOrder.length > 0 ? menu.dropdownRoleOrder : menu.dropdownRoles || []) 
            : (menu.buttonRoleOrder.length > 0 ? menu.buttonRoleOrder : menu.buttonRoles || []);
          
          if (actualRoles.length <= 1) {
            return sendEphemeralEmbed(interaction, `Not enough ${type} roles to reorder. Found ${actualRoles.length} role(s).`, "#FF0000", "Error", false);
          }

          // Create a user-friendly display of current roles with numbers
          const roleDisplay = currentOrder.map((roleId, index) => {
            const role = interaction.guild.roles.cache.get(roleId);
            const roleName = role ? role.name : `Unknown Role (${roleId})`;
            return `${index + 1}. ${roleName}`;
          }).join('\n');

          // Create example showing how to reorder
          const exampleOrder = currentOrder.length >= 3 
            ? `Example: "3, 1, 2" would move the 3rd role to first position`
            : `Example: "2, 1" would reverse the order`;

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:reorder_roles:${menuId}:${type}`)
            .setTitle(`Reorder ${type.charAt(0).toUpperCase() + type.slice(1)} Roles`);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("current_roles_display")
                .setLabel("Current Role Order (for reference)")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setValue(roleDisplay)
                .setMaxLength(2000)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("new_order_numbers")
                .setLabel("New Order (comma-separated numbers)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("1, 2, 3, 4...")
                .setValue("1, 2, 3, 4, 5".substring(0, currentOrder.length * 3 - 1)) // Default current order
                .setMaxLength(100)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("example_help")
                .setLabel("Help & Example")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(exampleOrder)
                .setMaxLength(200)
            )
          );
          
          return interaction.showModal(modal);
        }

        if (action === "setlimits") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:setlimits:${menuId}`)
            .setTitle("Set Regional Role Limits & Max Roles")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("au_limit")
                  .setLabel("Limit For AU Roles (Number, 0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("1")
                  .setValue(String(menu.regionalLimits?.AU?.limit?.toString() || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("eu_limit")
                  .setLabel("Limit For EU Roles (Number, 0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("1")
                  .setValue(String(menu.regionalLimits?.EU?.limit?.toString() || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("na_limit")
                  .setLabel("Limit For NA Roles (Number, 0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("1")
                  .setValue(String(menu.regionalLimits?.NA?.limit?.toString() || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("regional_role_assignments")
                  .setLabel("Regional Role Assignments (JSON Array of IDs)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder('{"AU": ["roleId1", "roleId2"], "EU": ["roleId3"]}')
                  .setValue(String(JSON.stringify(Object.fromEntries(
                    Object.entries(menu.regionalLimits || {}).map(([region, data]) => [region, data.roleIds || []])
                  )) || "{}"))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("max_roles_limit")
                  .setLabel("Max Roles Per Menu (Number, 0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("0")
                  .setValue(String(menu.maxRolesLimit !== null && menu.maxRolesLimit !== undefined ? menu.maxRolesLimit.toString() : ""))
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "setexclusions") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          if (!allRoles.size) return interaction.editReply({ content: "No roles available to set exclusions.", flags: MessageFlags.Ephemeral });

          const roleOptions = Array.from(allRoles.values()).slice(0, 25).map((r) => ({ label: r.name, value: r.id }));

          const selectTriggerRole = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_trigger_role:${menuId}`)
            .setPlaceholder("Select a role to set its exclusions...")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(roleOptions);

          return interaction.editReply({
            content: "Please select the role that, when picked, should remove other roles:",
            components: [new ActionRowBuilder().addComponents(selectTriggerRole)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "customize_embed") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

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
                  .setValue(String(menu.embedColor || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("thumbnail_url")
                  .setLabel("Thumbnail Image URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/thumbnail.png")
                  .setValue(String(menu.embedThumbnail || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("image_url")
                  .setLabel("Main Image URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/image.png")
                  .setValue(String(menu.embedImage || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("author_name")
                  .setLabel("Author Name (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("My Awesome Bot")
                  .setValue(String(menu.embedAuthorName || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("author_icon_url")
                  .setLabel("Author Icon URL (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/author_icon.png")
                  .setValue(String(menu.embedAuthorIconURL || ""))
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "customize_footer") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

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
                  .setValue(String(menu.embedFooterText || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("footer_icon_url")
                  .setLabel("Footer Icon URL (Optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/footer_icon.png")
                  .setValue(String(menu.embedFooterIconURL || ""))
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "custom_messages") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

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
                  .setValue(String(menu.successMessageAdd || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("success_remove_message")
                  .setLabel("Success Message (Role Removed)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("✅ You removed the role <@&{roleId}>!")
                  .setValue(String(menu.successMessageRemove || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("limit_exceeded_message")
                  .setLabel("Limit Exceeded Message")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("❌ You have reached the maximum number of roles for this menu or region.")
                  .setValue(String(menu.limitExceededMessage || ""))
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "toggle_member_counts") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const newState = !menu.showMemberCounts;
          await db.saveMemberCountSetting(menuId, newState);

          await sendEphemeralEmbed(interaction, `✅ Member counts are now ${newState ? "SHOWN" : "HIDDEN"} on roles.`, "#00FF00", "Success", false);
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "configure_button_colors") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:configure_button_colors:${menuId}`)
            .setTitle("Configure Button Colors");

          const buttonRoles = menu.buttonRoles || [];
          if (buttonRoles.length === 0) {
            return interaction.editReply({ content: "No button roles configured for this menu.", flags: MessageFlags.Ephemeral });
          }

          const maxInputs = Math.min(buttonRoles.length, 5);
          for (let i = 0; i < maxInputs; i++) {
            const roleId = buttonRoles[i];
            const role = interaction.guild.roles.cache.get(roleId);
            const currentColor = menu.buttonColors?.[roleId] || "Secondary";
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(roleId)
                  .setLabel(`Color for ${role ? role.name : "Unknown Role"}`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("Primary, Secondary, Success, Danger")
                  .setValue(String(currentColor))
              )
            );
          }
          return interaction.showModal(modal);
        }

        if (action === "save_as_template") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:save_as_template:${menuId}`)
            .setTitle("Save Menu as Template")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("template_name")
                  .setLabel("Template Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("e.g., Gaming Roles Template")
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("template_description")
                  .setLabel("Template Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("Describe what this template is for...")
                  .setMaxLength(500)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "clone_menu") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:clone_menu:${menuId}`)
            .setTitle("Clone Menu")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("new_name")
                  .setLabel("New Menu Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Enter name for the cloned menu")
                  .setValue(String(menu.name + " (Copy)"))
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("new_desc")
                  .setLabel("New Menu Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder("Enter description for the cloned menu")
                  .setValue(String(menu.desc))
                  .setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "browse_templates") {
          const templates = db.getTemplates();
          
          if (templates.length === 0) {
            return interaction.editReply({ 
              content: "❌ No templates available. Create a menu and save it as a template first!", 
              flags: MessageFlags.Ephemeral 
            });
          }

          const embed = new EmbedBuilder()
            .setTitle("📋 Available Templates")
            .setDescription("Select a template to create a new menu from:")
            .setColor("#5865F2");

          // Add template information to embed
          const templateList = templates.slice(0, 10).map((template, index) => {
            const rolesCount = (template.dropdownRoles?.length || 0) + (template.buttonRoles?.length || 0);
            return `**${index + 1}. ${template.templateName}**\n${template.templateDescription || "No description"}\n*${rolesCount} roles configured*`;
          }).join("\n\n");

          embed.setDescription(`Select a template to create a new menu from:\n\n${templateList}`);

          const templateOptions = templates.slice(0, 25).map((template) => ({
            label: template.templateName.substring(0, 100),
            value: template.id,
            description: template.templateDescription ? template.templateDescription.substring(0, 100) : "No description"
          }));

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("rr:select_template")
            .setPlaceholder("Choose a template...")
            .addOptions(templateOptions);

          const backButton = new ButtonBuilder()
            .setCustomId("dash:reaction-roles")
            .setLabel("Back to RR Dashboard")
            .setStyle(ButtonStyle.Secondary);

          const components = [
            new ActionRowBuilder().addComponents(selectMenu),
            new ActionRowBuilder().addComponents(backButton)
          ];

          console.log(`[Debug] Browse templates components: ${components.length} rows`);
          
          return interaction.editReply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
        }

        if (action === "toggle_webhook") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const newStateBoolean = !menu.useWebhook;
          await db.saveWebhookSettings(menuId, { useWebhook: newStateBoolean });

          await sendEphemeralEmbed(interaction, `✅ Webhook sending is now ${newStateBoolean ? "ENABLED" : "DISABLED"}.`, "#00FF00", "Success", false);
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "config_webhook") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

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
                  .setPlaceholder("My Bot Name")
                  .setValue(String(menu.webhookName || ""))
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("avatar")
                  .setLabel("Avatar URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/avatar.png")
                  .setValue(String(menu.webhookAvatar || ""))
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "prompt_role_description_select") {
            if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
            const menu = db.getMenu(menuId);
            if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

            const dropdownRoles = menu.dropdownRoles || [];
            if (dropdownRoles.length === 0) {
                return interaction.editReply({ content: "No dropdown roles configured for this menu. Please add dropdown roles first to set their descriptions.", flags: MessageFlags.Ephemeral });
            }

            const roleOptions = dropdownRoles.slice(0, 25).map(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                return {
                    label: role ? role.name : `Unknown Role (${roleId})`,
                    value: roleId
                };
            });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`rr:select_role_for_description:${menuId}`)
                .setPlaceholder("Select a dropdown role to set its description...")
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(roleOptions);

            return interaction.editReply({
                content: "Please select a dropdown role to set its description:",
                components: [new ActionRowBuilder().addComponents(selectMenu)],
                flags: MessageFlags.Ephemeral
            });
        }

        if (action === "manage_roles") {
          if (!menuId || !type) return interaction.editReply({ content: "Menu ID or type missing.", flags: MessageFlags.Ephemeral });
          return promptManageRoles(interaction, menuId, type);
        }

        if (action === "prompt_raw_embed_json") {
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:create_from_raw_json`)
            .setTitle("Create Menu from Raw Embed JSON");

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("raw_json_input")
                .setLabel("Paste Embed JSON Here")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder(JSON.stringify({title: "My Embed", description: "Hello!"}))
                .setMaxLength(4000)
            )
          );
          return interaction.showModal(modal);
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      
      if (ctx === "rr") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure reaction roles.", "#FF0000", "Permission Denied", false);
        }
        
        if (action === "selectmenu") {
          const targetMenuId = interaction.values[0];
          return showMenuConfiguration(interaction, targetMenuId);
        }

        if (action === "select_template") {
          const templateId = interaction.values[0];
          const template = db.getMenu(templateId);
          
          if (!template || !template.isTemplate) {
            return sendEphemeralEmbed(interaction, "❌ Template not found or invalid.", "#FF0000", "Error", false);
          }

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:create_from_template:${templateId}`)
            .setTitle("Create Menu from Template")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("new_name")
                  .setLabel("New Menu Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder(`Based on: ${template.templateName}`)
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("new_desc")
                  .setLabel("New Menu Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder("Describe your new menu...")
                  .setValue(template.desc || "")
                  .setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "save_managed_roles") {
          const selectedRoleIds = interaction.values;
          const type = parts[2];
          const menuId = parts[3];
          
          const menu = db.getMenu(menuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "Menu not found. Please re-select the menu.", "#FF0000", "Error", false);
          }

          await db.saveRoles(menuId, selectedRoleIds, type);

          await sendEphemeralEmbed(interaction, `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} roles updated.`, "#00FF00", "Success", false);
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "select_trigger_role") {
          const triggerRoleId = interaction.values[0];
          const menuId = parts[2];
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found. Please re-select the menu.", "#FF0000", "Error", false);
          }
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id && r.id !== triggerRoleId);

          if (!allRoles.size) {
            return sendEphemeralEmbed(interaction, "No other roles available to set as exclusions.", "#FF0000", "No Roles Found", false);
          }

          const roleOptions = Array.from(allRoles.values()).slice(0, 25).map((r) => ({
            label: r.name,
            value: r.id,
            default: (menu.exclusionMap[triggerRoleId] || []).includes(r.id)
          }));

          const selectExclusionRoles = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_exclusion_roles:${triggerRoleId}:${menuId}`)
            .setPlaceholder("Select roles to exclude when " + String(interaction.guild.roles.cache.get(triggerRoleId)?.name || "Unknown Role") + " is picked...")
            .setMinValues(0)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(roleOptions);

          return interaction.editReply({
            content: `Now select roles to be **removed** when <@&${triggerRoleId}> is added:`,
            components: [new ActionRowBuilder().addComponents(selectExclusionRoles)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "select_exclusion_roles") {
          const triggerRoleId = parts[2];
          const menuId = parts[3];
          const exclusionRoleIds = interaction.values;

          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found. Please re-select the menu.", "#FF0000", "Error", false);
          }
          const newExclusionMap = { ...menu.exclusionMap, [triggerRoleId]: exclusionRoleIds };
          await db.saveExclusionMap(menuId, newExclusionMap);

          await sendEphemeralEmbed(interaction, "✅ Exclusion roles saved!", "#00FF00", "Success", false);
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "select_role_for_description") {
          const roleId = interaction.values[0];
          const menuId = parts[2];
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
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
                  .setValue(String(currentDescription))
              )
            );
          return interaction.showModal(modal);
        }
      } else if (interaction.customId.startsWith("rr-role-select:")) {
          return handleRoleInteraction(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate().catch(e => console.error("Error deferring modal update:", e));
      }

      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const modalType = parts[2];

      let menuId;
      let type;
      let roleId;

      if (ctx === "rr" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure reaction roles.", "#FF0000", "Permission Denied", false);
        }

        if (modalType === "create") {
          const name = interaction.fields.getTextInputValue("name");
          const desc = interaction.fields.getTextInputValue("desc");
          const newMenuId = await db.createMenu(interaction.guild.id, name, desc);
          return showMenuConfiguration(interaction, newMenuId);
        }

        if (modalType === "addemoji") {
          type = parts[3];
          menuId = parts[4];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const emojis = {};
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const roles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
          for (let i = 0; i < Math.min(roles.length, 5); i++) {
            const currentRoleId = roles[i];
            const emojiInput = interaction.fields.getTextInputValue(currentRoleId);
            if (emojiInput) {
              const parsed = parseEmoji(emojiInput);
              if (parsed) {
                emojis[currentRoleId] = emojiInput;
              } else {
                console.warn(`Invalid emoji for role ${currentRoleId}: ${emojiInput}. Not saving.`);
              }
            } else {
              emojis[currentRoleId] = null;
            }
          }
          await db.saveEmojis(menuId, emojis, type);
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "reorder_roles") {
          menuId = parts[3];
          type = parts[4];
          try {
            if (!menuId) {
              return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
            }
            
            const menu = db.getMenu(menuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
            }

            // Get the number sequence input from user
            const numberOrderInput = interaction.fields.getTextInputValue("new_order_numbers");
            
            if (!numberOrderInput || !numberOrderInput.trim()) {
              return sendEphemeralEmbed(interaction, "No order sequence provided.", "#FF0000", "Error", false);
            }
            
            // Parse the numbers (e.g., "3, 1, 2" -> [3, 1, 2])
            const orderNumbers = numberOrderInput.split(",").map(num => {
              const parsed = parseInt(num.trim());
              return isNaN(parsed) ? null : parsed;
            }).filter(num => num !== null);
            
            if (orderNumbers.length === 0) {
              return sendEphemeralEmbed(interaction, "No valid numbers found in order sequence.", "#FF0000", "Error", false);
            }

            // Get current role order
            const existingRoles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
            const currentOrder = type === "dropdown" 
              ? (menu.dropdownRoleOrder.length > 0 ? menu.dropdownRoleOrder : menu.dropdownRoles || []) 
              : (menu.buttonRoleOrder.length > 0 ? menu.buttonRoleOrder : menu.buttonRoles || []);
            
            if (existingRoles.length === 0) {
              return sendEphemeralEmbed(interaction, `No ${type} roles found in this menu.`, "#FF0000", "Error", false);
            }
            
            // Validate that all numbers are within range
            const maxNumber = currentOrder.length;
            for (const num of orderNumbers) {
              if (num < 1 || num > maxNumber) {
                return sendEphemeralEmbed(interaction, `Invalid number: ${num}. Must be between 1 and ${maxNumber}.`, "#FF0000", "Error", false);
              }
            }
            
            // Convert numbers to role IDs based on current order
            const newOrderValidated = [];
            const usedNumbers = new Set();
            
            // First, add roles specified in the order
            for (const num of orderNumbers) {
              if (!usedNumbers.has(num)) {
                const roleIndex = num - 1; // Convert to 0-based index
                if (roleIndex >= 0 && roleIndex < currentOrder.length) {
                  newOrderValidated.push(currentOrder[roleIndex]);
                  usedNumbers.add(num);
                }
              }
            }
            
            // Then add any remaining roles that weren't specified
            for (let i = 0; i < currentOrder.length; i++) {
              const num = i + 1;
              if (!usedNumbers.has(num)) {
                newOrderValidated.push(currentOrder[i]);
              }
            }

            if (newOrderValidated.length !== currentOrder.length) {
              console.warn(`Mismatch in role count for menu ${menuId}. Expected: ${currentOrder.length}, Got: ${newOrderValidated.length}`);
            }

            await db.saveRoleOrder(menuId, newOrderValidated, type);
            
            return showMenuConfiguration(interaction, menuId);
            
          } catch (error) {
            console.error("Error in reorder modal submission:", error);
            return sendEphemeralEmbed(interaction, "An error occurred while reordering roles. Please check your input format.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "setlimits") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
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
            return sendEphemeralEmbed(interaction, "❌ Invalid JSON for Regional Role Assignments. Please check the format.", "#FF0000", "Input Error", false);
          }

          await db.saveRegionalLimits(menuId, newRegionalLimits);

          let maxRolesLimit = null;
          if (maxRolesLimitInput) {
            const parsedLimit = parseInt(maxRolesLimitInput);
            if (!isNaN(parsedLimit) && parsedLimit >= 0) {
              maxRolesLimit = parsedLimit;
            } else {
              return sendEphemeralEmbed(interaction, "❌ Invalid value for Max Roles Per Menu. Please enter a number.", "#FF0000", "Input Error", false);
            }
          }
          await db.saveMaxRolesLimit(menuId, maxRolesLimit);
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "customize_embed") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const embedColor = interaction.fields.getTextInputValue("embed_color") || null;
          const embedThumbnail = interaction.fields.getTextInputValue("thumbnail_url") || null;
          const embedImage = interaction.fields.getTextInputValue("image_url") || null;
          const embedAuthorName = interaction.fields.getTextInputValue("author_name") || null;
          const embedAuthorIconURL = interaction.fields.getTextInputValue("author_icon_url") || null;

          if (embedColor && !/^#[0-9A-F]{6}$/i.test(embedColor)) {
            return sendEphemeralEmbed(interaction, "❌ Invalid color format. Please use hex format like #FF0000", "#FF0000", "Input Error", false);
          }

          await db.saveEmbedCustomization(menuId, {
            embedColor,
            embedThumbnail,
            embedImage,
            embedAuthorName,
            embedAuthorIconURL,
          });
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "customize_footer") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const footerText = interaction.fields.getTextInputValue("footer_text") || null;
          const footerIconURL = interaction.fields.getTextInputValue("footer_icon_url") || null;

          await db.saveEmbedCustomization(menuId, {
            embedFooterText: footerText,
            embedFooterIconURL: footerIconURL,
          });
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "custom_messages") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const successAdd = interaction.fields.getTextInputValue("success_add_message") || null;
          const successRemove = interaction.fields.getTextInputValue("success_remove_message") || null;
          const limitExceeded = interaction.fields.getTextInputValue("limit_exceeded_message") || null;

          await db.saveCustomMessages(menuId, {
            successMessageAdd: successAdd || "✅ You now have the role <@&{roleId}>!",
            successMessageRemove: successRemove || "✅ You removed the role <@&{roleId}>!",
            limitExceededMessage: limitExceeded || "❌ You have reached the maximum number of roles for this menu or region.",
          });
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "role_description") {
          menuId = parts[3];
          roleId = parts[4];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }
          const description = interaction.fields.getTextInputValue("description_input");
          await db.saveRoleDescriptions(menuId, { [roleId]: description || null });
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "webhook_branding") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const name = interaction.fields.getTextInputValue("name");
          const avatar = interaction.fields.getTextInputValue("avatar");

          await db.saveWebhookSettings(menuId, {
            webhookName: name || null,
            webhookAvatar: avatar || null
          });
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "create_from_raw_json") {
            const jsonString = interaction.fields.getTextInputValue("raw_json_input");

            let parsedJson;
            try {
                parsedJson = JSON.parse(jsonString);
            } catch (e) {
                return sendEphemeralEmbed(interaction, "❌ Invalid JSON format. Please ensure it's valid JSON.", "#FF0000", "Input Error", false);
            }

            const embedData = (parsedJson.embeds && Array.isArray(parsedJson.embeds) && parsedJson.embeds.length > 0)
                               ? parsedJson.embeds[0]
                               : parsedJson;

            const menuName = embedData.title || "New Menu from JSON";
            const menuDescription = embedData.description || "No description provided.";

            const newMenuId = await db.createMenu(interaction.guild.id, menuName, menuDescription);
            
            const embedUpdateData = {};

            if (typeof embedData.color === 'number') {
                embedUpdateData.embedColor = '#' + (embedData.color >>> 0).toString(16).padStart(6, '0');
            } else if (typeof embedData.color === 'string' && /^#[0-9A-F]{6}$/i.test(embedData.color)) {
                embedUpdateData.embedColor = embedData.color;
            } else {
                embedUpdateData.embedColor = null;
            }
            
            embedUpdateData.embedThumbnail = embedData.thumbnail?.url || null;
            embedUpdateData.embedImage = embedData.image?.url || null;
            embedUpdateData.embedAuthorName = embedData.author?.name || null;
            embedUpdateData.embedAuthorIconURL = embedData.author?.icon_url || null;
            embedUpdateData.embedFooterText = embedData.footer?.text || null;
            embedUpdateData.embedFooterIconURL = embedData.footer?.icon_url || null;
            
            await db.saveEmbedCustomization(newMenuId, embedUpdateData);
            
            return showMenuConfiguration(interaction, newMenuId);
        }

        if (modalType === "configure_button_colors") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const colors = {};
          const buttonRoles = menu.buttonRoles || [];
          const validStyles = ['Primary', 'Secondary', 'Success', 'Danger'];
          
          for (let i = 0; i < Math.min(buttonRoles.length, 5); i++) {
            const currentRoleId = buttonRoles[i];
            const colorInput = interaction.fields.getTextInputValue(currentRoleId);
            if (colorInput) {
              const colorName = colorInput.trim();
              if (validStyles.includes(colorName)) {
                colors[currentRoleId] = colorName;
              } else {
                console.warn(`Invalid button color for role ${currentRoleId}: ${colorInput}. Using Secondary.`);
                colors[currentRoleId] = 'Secondary';
              }
            }
          }
          
          await db.saveButtonColors(menuId, colors);
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "save_as_template") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const templateName = interaction.fields.getTextInputValue("template_name");
          const templateDescription = interaction.fields.getTextInputValue("template_description") || "";
          
          if (!templateName || templateName.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Template name is required.", "#FF0000", "Input Error", false);
          }

          await db.saveAsTemplate(menuId, templateName.trim(), templateDescription.trim());
          await sendEphemeralEmbed(interaction, `✅ Menu saved as template: "${templateName}"`, "#00FF00", "Success", false);
          return showMenuConfiguration(interaction, menuId);
        }

        if (modalType === "clone_menu") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const newName = interaction.fields.getTextInputValue("new_name");
          const newDesc = interaction.fields.getTextInputValue("new_desc");
          
          if (!newName || newName.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Menu name is required.", "#FF0000", "Input Error", false);
          }
          
          if (!newDesc || newDesc.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Menu description is required.", "#FF0000", "Input Error", false);
          }

          try {
            const newMenuId = await db.createFromTemplate(menuId, interaction.guild.id, newName.trim(), newDesc.trim());
            await sendEphemeralEmbed(interaction, `✅ Menu cloned successfully! New menu: "${newName}"`, "#00FF00", "Success", false);
            return showMenuConfiguration(interaction, newMenuId);
          } catch (error) {
            console.error("Error cloning menu:", error);
            return sendEphemeralEmbed(interaction, "❌ Failed to clone menu. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "create_from_template") {
          const templateId = parts[3];
          if (!templateId) return sendEphemeralEmbed(interaction, "Template ID missing.", "#FF0000", "Error", false);
          
          const template = db.getMenu(templateId);
          if (!template || !template.isTemplate) {
              return sendEphemeralEmbed(interaction, "Template not found or invalid.", "#FF0000", "Error", false);
          }

          const newName = interaction.fields.getTextInputValue("new_name");
          const newDesc = interaction.fields.getTextInputValue("new_desc");
          
          if (!newName || newName.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Menu name is required.", "#FF0000", "Input Error", false);
          }
          
          if (!newDesc || newDesc.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Menu description is required.", "#FF0000", "Input Error", false);
          }

          try {
            const newMenuId = await db.createFromTemplate(templateId, interaction.guild.id, newName.trim(), newDesc.trim());
            await sendEphemeralEmbed(interaction, `✅ Menu created from template "${template.templateName}"! New menu: "${newName}"`, "#00FF00", "Success", false);
            return showMenuConfiguration(interaction, newMenuId);
          } catch (error) {
            console.error("Error creating menu from template:", error);
            return sendEphemeralEmbed(interaction, "❌ Failed to create menu from template. Please try again.", "#FF0000", "Error", false);
          }
        }
      }

      if (ctx === "im" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure interactive menus.", "#FF0000", "Permission Denied", false);
        }

        if (modalType === "create") {
          const name = interaction.fields.getTextInputValue("name");
          const description = interaction.fields.getTextInputValue("description");
          const newMenuId = await db.createInteractiveMenu(interaction.guild.id, name, description);
          return showInteractiveMenuConfiguration(interaction, newMenuId);
        }

        if (modalType === "add_page") {
          menuId = parts[3];
          if (!menuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error", false);
          
          const menu = db.getInteractiveMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }

          const title = interaction.fields.getTextInputValue("title");
          const content = interaction.fields.getTextInputValue("content");
          
          if (!title || title.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Page title is required.", "#FF0000", "Input Error", false);
          }
          
          if (!content || content.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Page content is required.", "#FF0000", "Input Error", false);
          }

          // Add the page to the menu
          const pages = menu.pages || [];
          const newPage = {
            id: Date.now().toString(),
            title: title.trim(),
            content: content.trim(),
            createdAt: Date.now()
          };
          pages.push(newPage);

          await db.updateInteractiveMenu(menuId, { pages });
          await sendEphemeralEmbed(interaction, `✅ Page "${title}" added successfully!`, "#00FF00", "Success", false);
          return showInteractiveMenuConfiguration(interaction, menuId);
        }
      }
    }

    if ((interaction.isStringSelectMenu() && interaction.customId.startsWith("rr-role-select:")) ||
        (interaction.isButton() && interaction.customId.startsWith("rr-role-button:"))) {
        
        return handleRoleInteraction(interaction);
    }

  } catch (error) {
      console.error("Unhandled error during interaction:", error);
      if (!interaction.replied && !interaction.deferred) {
          try {
              await interaction.reply({ content: "❌ An unexpected error occurred. Please try again.", ephemeral: true });
          } catch (replyError) {
              console.error("Error sending fallback error reply:", replyError);
          }
      } else {
          try {
            await interaction.editReply({ content: "❌ An unexpected error occurred. Please try again.", embeds: [], components: [] });
          } catch (editError) {
              console.error("Error sending fallback error editReply:", editError);
          }
      }
  }
});

async function handleRoleInteraction(interaction) {
    if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(e => console.error("Error deferring reply for role interaction:", e));
    }

    try {
        // Check rate limiting
        if (isOnRoleInteractionCooldown(interaction.user.id)) {
            const timeLeft = Math.ceil((ROLE_INTERACTION_COOLDOWN - (Date.now() - roleInteractionCooldowns.get(interaction.user.id))) / 1000);
            return sendEphemeralEmbed(interaction, `⏰ Please wait ${timeLeft} seconds before using role interactions again.`, "#FFAA00", "Rate Limited");
        }

        const parts = interaction.customId.split(":");
        const menuId = parts[1];
        
        console.log(`[DEBUG] Extracted menuId: "${menuId}"`);
        
        if (!menuId || menuId === 'undefined') {
            console.error(`[Error] Invalid menuId found in customId: ${interaction.customId}`);
            return sendEphemeralEmbed(interaction, "❌ This reaction role menu has an invalid configuration. Please contact an administrator.", "#FF0000", "Error");
        }
        
        const menu = db.getMenu(menuId);
        
        if (!menu) {
            console.error(`[Error] Attempted to access non-existent menu with ID: ${menuId}. CustomId: ${interaction.customId}`);
            return sendEphemeralEmbed(interaction, "❌ This reaction role menu is no longer valid. It might have been deleted or corrupted.", "#FF0000", "Error");
        }

        // Set cooldown
        setRoleInteractionCooldown(interaction.user.id);

        // Validate guild and member
        if (!interaction.guild || !interaction.member) {
            console.error(`[Error] Invalid guild or member for menu ${menuId}`);
            return sendEphemeralEmbed(interaction, "❌ Unable to process role interaction. Please try again.", "#FF0000", "Error");
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            console.error(`[Error] Could not fetch member ${interaction.user.id} for menu ${menuId}`);
            return sendEphemeralEmbed(interaction, "❌ Unable to fetch your member information. Please try again.", "#FF0000", "Error");
        }

        const currentRoles = new Set(member.roles.cache.map(r => r.id));
        
        let newRoles = new Set(currentRoles);

        console.log(`[DEBUG] Current roles before interaction:`, Array.from(currentRoles));

        if (interaction.isStringSelectMenu()) {
            const selectedValues = interaction.values;
            
            console.log(`[DEBUG] Dropdown - Selected values:`, selectedValues);
            
            // Validate all selected roles still exist
            const validSelectedValues = selectedValues.filter(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) {
                    console.warn(`[Warning] Selected role ${roleId} no longer exists in guild`);
                    return false;
                }
                return true;
            });
            
            if (validSelectedValues.length === 0) {
                return sendEphemeralEmbed(interaction, "❌ None of the selected roles exist anymore. Please contact an administrator.", "#FF0000", "Error");
            }
            
            // Toggle each selected role individually
            for (const selectedRoleId of validSelectedValues) {
                const selectedRole = interaction.guild.roles.cache.get(selectedRoleId);
                if (newRoles.has(selectedRoleId)) {
                    newRoles.delete(selectedRoleId);
                    console.log(`[DEBUG] Toggled OFF role: ${selectedRoleId} (${selectedRole.name})`);
                } else {
                    newRoles.add(selectedRoleId);
                    console.log(`[DEBUG] Toggled ON role: ${selectedRoleId} (${selectedRole.name})`);
                }
            }
            
        } else if (interaction.isButton()) { // Button
            const clickedRoleId = parts[2];
            console.log(`[DEBUG] Button - Clicked role ID:`, clickedRoleId);
            
            // Validate clicked role still exists
            const clickedRole = interaction.guild.roles.cache.get(clickedRoleId);
            if (!clickedRole) {
                console.warn(`[Warning] Clicked role ${clickedRoleId} no longer exists in guild`);
                return sendEphemeralEmbed(interaction, "❌ The selected role no longer exists. Please contact an administrator.", "#FF0000", "Error");
            }
            
            if (newRoles.has(clickedRoleId)) {
                newRoles.delete(clickedRoleId);
            } else {
                newRoles.add(clickedRoleId);
            }
        } else {
            console.error(`[Error] Unexpected interaction type for menu ${menuId}`);
            return sendEphemeralEmbed(interaction, "❌ Unexpected interaction type. Please try again.", "#FF0000", "Error");
        }

        console.log(`[DEBUG] New roles after interaction logic:`, Array.from(newRoles));

        const rolesBeingAdded = Array.from(newRoles).filter(id => !currentRoles.has(id));
        console.log(`[DEBUG] Roles being added:`, rolesBeingAdded);

        // Handle exclusions
        for (const addedRoleId of rolesBeingAdded) {
            if (menu.exclusionMap && menu.exclusionMap[addedRoleId]) {
                const rolesToExclude = menu.exclusionMap[addedRoleId];
                console.log(`[DEBUG] Role ${addedRoleId} excludes:`, rolesToExclude);
                
                for (const excludedRoleId of rolesToExclude) {
                    if (newRoles.has(excludedRoleId)) {
                        newRoles.delete(excludedRoleId);
                        const excludedRole = interaction.guild.roles.cache.get(excludedRoleId);
                        console.log(`[DEBUG] Excluded role due to conflict: ${excludedRoleId} (${excludedRole?.name || 'Unknown Role'})`);
                    }
                }
            }
        }

        console.log(`[DEBUG] Final new roles after exclusions:`, Array.from(newRoles));

        const allMenuRoles = [...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])];
        const newMenuRoles = Array.from(newRoles).filter(id => allMenuRoles.includes(id));

        // Check regional limits
        const regionalViolations = checkRegionalLimits(member, menu, newMenuRoles);
        if (regionalViolations.length > 0) {
            await sendEphemeralEmbed(interaction, menu.limitExceededMessage || `❌ ${regionalViolations.join("\n")}`, "#FF0000", "Limit Exceeded");
            await updatePublishedMessageComponents(interaction, menu, menuId);
            return;
        }

        // Check max roles limit
        if (menu.maxRolesLimit !== null && menu.maxRolesLimit > 0) {
            if (newMenuRoles.length > menu.maxRolesLimit) {
                await sendEphemeralEmbed(interaction, menu.limitExceededMessage || `❌ You can only have a maximum of ${menu.maxRolesLimit} roles from this menu.`, "#FF0000", "Limit Exceeded");
                await updatePublishedMessageComponents(interaction, menu, menuId);
                return;
            }
        }

        const rolesToAdd = Array.from(newRoles).filter(id => !currentRoles.has(id));
        const rolesToRemove = Array.from(currentRoles).filter(id => !newRoles.has(id));

        console.log(`[DEBUG] Final roles to add:`, rolesToAdd);
        console.log(`[DEBUG] Final roles to remove:`, rolesToRemove);

        // Filter out roles that don't exist anymore
        const validRolesToAdd = rolesToAdd.filter(id => interaction.guild.roles.cache.has(id));
        const validRolesToRemove = rolesToRemove.filter(id => interaction.guild.roles.cache.has(id));

        // Apply role changes
        if (validRolesToAdd.length > 0) {
            await member.roles.add(validRolesToAdd);
        }
        if (validRolesToRemove.length > 0) {
            await member.roles.remove(validRolesToRemove);
        }

        // Send rich embed notification for role changes
        if (validRolesToAdd.length > 0 || validRolesToRemove.length > 0) {
            await sendRoleChangeNotification(interaction, validRolesToAdd, validRolesToRemove, member);
        } else {
            await sendEphemeralEmbed(interaction, "No changes made to your roles.", "#FFFF00", "No Change");
        }

        // Update published message components
        await updatePublishedMessageComponents(interaction, menu, menuId);

    } catch (error) {
        console.error("Error in handleRoleInteraction:", error);
        
        let errorMessage = "❌ There was an error updating your roles.";
        
        if (error.code === 50013) {
            errorMessage = "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.";
        } else if (error.code === 10011) {
            errorMessage = "❌ One or more roles no longer exist. Please contact an administrator to update the menu.";
        } else if (error.code === 50001) {
            errorMessage = "❌ I don't have access to manage roles in this server. Please check my permissions.";
        }
        
        await sendEphemeralEmbed(interaction, errorMessage, "#FF0000", "Error");
    }
}

/**
 * Helper function to prompt the user to select roles for a given type (dropdown or button).
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} menuId - The ID of the menu being configured.
 * @param {'dropdown'|'button'} type - The type of roles to manage.
 */
async function promptManageRoles(interaction, menuId, type) {
    const menu = db.getMenu(menuId);
    if (!menu) {
      return sendEphemeralEmbed(interaction, "Menu not found. Please re-select the menu.", "#FF0000", "Error", false);
    }

    const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
    if (allRoles.size === 0) {
      return sendEphemeralEmbed(interaction, "❌ No roles available in this guild to manage. Please create some roles first.", "#FF0000", "No Roles Found", false);
    }

    const currentRolesForType = (menu[type + "Roles"] || []);

    const roleOptions = Array.from(allRoles.values()).slice(0, 25).map((r) => ({
        label: r.name,
        value: r.id,
        default: currentRolesForType.includes(r.id)
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`rr:save_managed_roles:${type}:${menuId}`)
      .setPlaceholder("Select/Deselect your " + type + " roles...")
      .setMinValues(0)
      .setMaxValues(Math.min(allRoles.size, 25))
      .addOptions(roleOptions);

    await interaction.editReply({
      content: `Please select all roles you want for the **${type}** menu (select/deselect to add/remove):`,
      components: [new ActionRowBuilder().addComponents(select)],
      flags: MessageFlags.Ephemeral
    });
}


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
          .setEmoji("🎭")
  );
  await interaction.editReply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
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
      const menuOptions = menus.slice(0, 25).map((menu) => ({ 
          label: menu.name.substring(0, 100), 
          value: menu.id,
          description: menu.desc ? menu.desc.substring(0, 100) : undefined
      }));
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

  const rawJsonButton = new ButtonBuilder()
      .setCustomId(`rr:prompt_raw_embed_json`)
      .setLabel("Create from Raw Embed JSON")
      .setStyle(ButtonStyle.Secondary);

  const templateButton = new ButtonBuilder()
      .setCustomId("rr:browse_templates")
      .setLabel("Create from Template")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📋");

  const backButton = new ButtonBuilder()
      .setCustomId("dash:back")
      .setLabel("Back to Dashboard")
      .setStyle(ButtonStyle.Secondary);

  components.push(new ActionRowBuilder().addComponents(createButton, templateButton, rawJsonButton));
  components.push(new ActionRowBuilder().addComponents(backButton));

  console.log(`[Debug] RR Dashboard components: ${components.length} rows`);

  try {
      await interaction.editReply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  } catch (error) {
      console.error("Error displaying reaction roles dashboard:", error);
      console.error("Dashboard components structure:", JSON.stringify(components.map(row => ({
        components: row.components.length
      })), null, 2));
      await interaction.editReply({ content: "❌ Something went wrong while displaying the reaction roles dashboard.", flags: MessageFlags.Ephemeral });
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
        flags: MessageFlags.Ephemeral
      });
    }

    const menu = db.getMenu(menuId);
    if (!menu) {
      console.error(`Menu not found for ID: ${menuId}`);
      return interaction.editReply({ content: "Menu not found. It might have been deleted.", flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Configuring: ${menu.name}`)
      .setDescription(menu.desc)
      .addFields(
        { name: "Menu ID", value: `\`${menuId}\``, inline: true },
        { name: "Selection Type", value: menu.selectionType.join(" & ") || "Not set", inline: true },
        { name: "Published", value: menu.messageId ? `✅ Yes in <#${menu.channelId}>` : "❌ No", inline: true },
        { name: "Dropdown Roles", value: menu.dropdownRoles.length > 0 ? menu.dropdownRoles.slice(0, 10).map((r) => `<@&${r}>`).join(", ") + (menu.dropdownRoles.length > 10 ? ` (+${menu.dropdownRoles.length - 10} more)` : "") : "None", inline: false },
        { name: "Button Roles", value: menu.buttonRoles.length > 0 ? menu.buttonRoles.slice(0, 10).map((r) => `<@&${r}>`).join(", ") + (menu.buttonRoles.length > 10 ? ` (+${menu.buttonRoles.length - 10} more)` : "") : "None", inline: false },
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

    embed.addFields(
      {
        name: "Webhook Sending",
        value: menu.useWebhook ? "✅ Enabled" : "❌ Disabled",
        inline: true
      },
      {
        name: "Webhook Branding",
        value: menu.useWebhook
          ? (menu.webhookName
            ? `Name: ${menu.webhookName}\n${menu.webhookAvatar ? "Custom Avatar" : "Default Avatar"}`
            : "Not configured")
          : "N/A (Webhook Disabled)",
        inline: true
      },
      {
        name: "Advanced Features",
        value: `Member Counts: ${menu.showMemberCounts ? "✅ Shown" : "❌ Hidden"}\n` +
               `Button Colors: ${Object.keys(menu.buttonColors || {}).length > 0 ? "✅ Customized" : "❌ Default"}\n` +
               `Template: ${menu.isTemplate ? `✅ "${menu.templateName}"` : "❌ No"}`,
        inline: true
      }
    );

    const row_publish_delete = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rr:publish:${menuId}`)
        .setLabel("Publish Menu")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!menu.selectionType.length || (!menu.dropdownRoles.length && !menu.buttonRoles.length)),
      new ButtonBuilder()
        .setCustomId(`rr:edit_published:${menuId}`)
        .setLabel("Update Published Menu")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!menu.messageId),
      new ButtonBuilder()
        .setCustomId(`rr:delete_published:${menuId}`)
        .setLabel("Delete Published Message")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!menu.messageId),
      new ButtonBuilder()
        .setCustomId(`rr:delete_menu:${menuId}`)
        .setLabel("Delete This Menu")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("dash:reaction-roles")
        .setLabel("Back to RR Dashboard")
        .setStyle(ButtonStyle.Secondary)
    );

    const row_role_types_and_management = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rr:toggle_type:dropdown:${menuId}`)
        .setLabel(menu.selectionType.includes("dropdown") ? "Disable Dropdown Roles" : "Enable Dropdown Roles")
        .setStyle(menu.selectionType.includes("dropdown") ? ButtonStyle.Danger : ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rr:toggle_type:button:${menuId}`)
        .setLabel(menu.selectionType.includes("button") ? "Disable Button Roles" : "Enable Button Roles")
        .setStyle(menu.selectionType.includes("button") ? ButtonStyle.Danger : ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rr:manage_roles:dropdown:${menuId}`)
        .setLabel("Manage Dropdown Roles")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!menu.selectionType.includes("dropdown")),
      new ButtonBuilder()
        .setCustomId(`rr:manage_roles:button:${menuId}`)
        .setLabel("Manage Button Roles")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!menu.selectionType.includes("button"))
    );

    const row_emojis_reorder = new ActionRowBuilder().addComponents(
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
        .setDisabled(menu.buttonRoles.length <= 1),
      new ButtonBuilder()
        .setCustomId(`rr:configure_button_colors:${menuId}`)
        .setLabel("Button Colors")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!menu.buttonRoles.length)
    );

    const row_limits_exclusions_descriptions = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rr:setlimits:${menuId}`)
        .setLabel("Set Regional Limits & Max Roles")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rr:setexclusions:${menuId}`)
        .setLabel("Set Role Exclusions")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rr:prompt_role_description_select:${menuId}`)
        .setLabel("Set Role Descriptions")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!menu.dropdownRoles.length),
      new ButtonBuilder()
        .setCustomId(`rr:toggle_member_counts:${menuId}`)
        .setLabel(menu.showMemberCounts ? "Hide Counts" : "Show Counts")
        .setStyle(menu.showMemberCounts ? ButtonStyle.Danger : ButtonStyle.Success)
    );

    const row_customization_webhook = new ActionRowBuilder();
    row_customization_webhook.addComponents(
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
        .setStyle(menu.useWebhook ? ButtonStyle.Danger : ButtonStyle.Success)
    );

    // Add conditional 5th button based on webhook state
    if (menu.useWebhook) {
      row_customization_webhook.addComponents(
        new ButtonBuilder()
          .setCustomId(`rr:config_webhook:${menuId}`)
          .setLabel("Configure Branding")
          .setStyle(ButtonStyle.Primary)
      );
    } else {
      row_customization_webhook.addComponents(
        new ButtonBuilder()
          .setCustomId(`rr:save_as_template:${menuId}`)
          .setLabel("Save as Template")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    // Create a separate row for template actions when webhook is disabled
    const templateActionsRow = !menu.useWebhook ? new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rr:clone_menu:${menuId}`)
        .setLabel("Clone Menu")
        .setStyle(ButtonStyle.Secondary)
    ) : null;

    const baseComponents = [
      row_publish_delete,
      row_role_types_and_management,
      row_emojis_reorder,
      row_limits_exclusions_descriptions,
      row_customization_webhook,
    ];

    // Add template actions row if it exists and we have room
    if (templateActionsRow && baseComponents.length < 5) {
      baseComponents.push(templateActionsRow);
    }

    const finalComponents = baseComponents.filter(row => row.components.length > 0);

    // Debug logging to identify component issues
    console.log(`[Debug] Menu ${menuId} components: ${finalComponents.length} rows`);
    finalComponents.forEach((row, index) => {
      console.log(`[Debug] Row ${index + 1}: ${row.components.length} buttons`);
    });

    // Ensure we never exceed Discord's limits
    if (finalComponents.length > 5) {
      console.warn(`[Warning] Too many component rows (${finalComponents.length}), trimming to 5`);
      finalComponents.splice(5); // Remove excess rows
    }

    // Check each row doesn't exceed 5 buttons
    finalComponents.forEach((row, index) => {
      if (row.components.length > 5) {
        console.warn(`[Warning] Row ${index + 1} has ${row.components.length} buttons, trimming to 5`);
        row.components.splice(5); // Remove excess buttons
      }
    });

    try {
      await interaction.editReply({ embeds: [embed], components: finalComponents, flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error("Error displaying menu configuration:", error);
      console.error("Components structure:", JSON.stringify(finalComponents.map(row => ({
        components: row.components.length
      })), null, 2));
      await interaction.editReply({ content: "❌ Something went wrong while displaying the menu configuration.", flags: MessageFlags.Ephemeral });
    }
}

/**
 * Publishes a reaction role menu message to a channel, or edits an existing one.
 * @param {import('discord.js').Interaction} interaction - The interaction that triggered the publish.
 * @param {string} menuId - The ID of the menu to publish.
 * @param {import('discord.js').Message} [messageToEdit=null] - An optional existing message to edit instead of sending a new one.
 */
async function publishMenu(interaction, menuId, messageToEdit = null) {
    if (!menuId || typeof menuId !== 'string') {
        return interaction.editReply({ content: "❌ Invalid menu ID provided.", flags: MessageFlags.Ephemeral });
    }

    const menu = db.getMenu(menuId);
    if (!menu) {
        return interaction.editReply({ content: "❌ Menu not found.", flags: MessageFlags.Ephemeral });
    }

    // Validate guild and permissions
    if (!interaction.guild) {
        return interaction.editReply({ content: "❌ This command can only be used in a server.", flags: MessageFlags.Ephemeral });
    }

    // Check if bot has necessary permissions
    const botMember = interaction.guild.members.me;
    if (!botMember) {
        return interaction.editReply({ content: "❌ Unable to verify bot permissions.", flags: MessageFlags.Ephemeral });
    }

    const channel = messageToEdit ? messageToEdit.channel : interaction.channel;
    if (!channel.permissionsFor(botMember).has(['SendMessages', 'UseExternalEmojis', 'EmbedLinks'])) {
        return interaction.editReply({ content: "❌ Bot lacks required permissions in this channel: Send Messages, Use External Emojis, Embed Links.", flags: MessageFlags.Ephemeral });
    }

    if (menu.useWebhook && !channel.permissionsFor(botMember).has('ManageWebhooks')) {
        return interaction.editReply({ content: "❌ Webhook mode is enabled but bot lacks 'Manage Webhooks' permission.", flags: MessageFlags.Ephemeral });
    }

    // Validate menu configuration
    if (!menu.selectionType.length || (menu.selectionType.includes('dropdown') && !menu.dropdownRoles.length) && (menu.selectionType.includes('button') && !menu.buttonRoles.length)) {
        return interaction.editReply({ content: "❌ Cannot publish: Please configure at least one role for the enabled component types.", flags: MessageFlags.Ephemeral });
    }

    // Validate roles still exist
    const allConfiguredRoles = [...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])];
    const validRoles = allConfiguredRoles.filter(roleId => interaction.guild.roles.cache.has(roleId));
    const invalidRoles = allConfiguredRoles.filter(roleId => !interaction.guild.roles.cache.has(roleId));

    if (invalidRoles.length > 0) {
        console.warn(`Menu ${menuId} contains ${invalidRoles.length} invalid roles:`, invalidRoles);
        // Optionally clean up invalid roles from the menu
        if (menu.dropdownRoles) {
            menu.dropdownRoles = menu.dropdownRoles.filter(roleId => interaction.guild.roles.cache.has(roleId));
        }
        if (menu.buttonRoles) {
            menu.buttonRoles = menu.buttonRoles.filter(roleId => interaction.guild.roles.cache.has(roleId));
        }
        await db.updateMenu(menuId, { 
            dropdownRoles: menu.dropdownRoles, 
            buttonRoles: menu.buttonRoles 
        });
    }

    if (validRoles.length === 0) {
        return interaction.editReply({ content: "❌ Cannot publish: All configured roles have been deleted. Please reconfigure the menu.", flags: MessageFlags.Ephemeral });
    }

    try {
        const embed = await createReactionRoleEmbed(interaction.guild, menu);
        const components = [];

        // Build dropdown components
        if (menu.selectionType.includes("dropdown") && (menu.dropdownRoles && menu.dropdownRoles.length > 0)) {
          const dropdownOptions = (menu.dropdownRoleOrder.length > 0
            ? menu.dropdownRoleOrder
            : menu.dropdownRoles
          ).map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return null;
            
            // Get member count if enabled
            const memberCount = menu.showMemberCounts ? role.members.size : null;
            const labelText = memberCount !== null 
                ? `${role.name} (${memberCount})` 
                : role.name;
            
            return {
              label: labelText.substring(0, 100),
              value: role.id,
              emoji: parseEmoji(menu.dropdownEmojis[role.id]),
              description: menu.dropdownRoleDescriptions[role.id] ? menu.dropdownRoleDescriptions[role.id].substring(0, 100) : undefined,
              default: false
            };
          }).filter(Boolean);

          if (dropdownOptions.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(`rr-role-select:${menuId}`)
              .setPlaceholder("Select roles to toggle...")
              .setMinValues(1)
              .setMaxValues(dropdownOptions.length)
              .addOptions(dropdownOptions);
            components.push(new ActionRowBuilder().addComponents(selectMenu));
          }
        }

        // Build button components
        if (menu.selectionType.includes("button") && (menu.buttonRoles && menu.buttonRoles.length > 0)) {
          const buttonRows = [];
          let currentRow = new ActionRowBuilder();
          const orderedButtonRoles = menu.buttonRoleOrder.length > 0
            ? menu.buttonRoleOrder
            : menu.buttonRoles;

          for (const roleId of orderedButtonRoles) {
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) continue;

            // Get member count if enabled
            const memberCount = menu.showMemberCounts ? role.members.size : null;
            const labelText = memberCount !== null 
                ? `${role.name} (${memberCount})` 
                : role.name;

            // Get custom button color or default to secondary
            const buttonColorName = menu.buttonColors?.[role.id] || 'Secondary';
            const buttonStyle = ButtonStyle[buttonColorName] || ButtonStyle.Secondary;

            const button = new ButtonBuilder()
              .setCustomId(`rr-role-button:${menuId}:${role.id}`)
              .setLabel(labelText.substring(0, 80))
              .setStyle(buttonStyle);

            const parsedEmoji = parseEmoji(menu.buttonEmojis[role.id]);
            if (parsedEmoji) {
              button.setEmoji(parsedEmoji);
            }

            if (currentRow.components.length < 5) {
              currentRow.addComponents(button);
            } else {
              buttonRows.push(currentRow);
              currentRow = new ActionRowBuilder().addComponents(button);
              if (buttonRows.length >= 4) break; // Discord limit
            }
          }
          if (currentRow.components.length > 0 && buttonRows.length < 4) {
            buttonRows.push(currentRow);
          }
          components.push(...buttonRows);
        }

        // Clean up old message if publishing a new one
        if (menu.messageId && !messageToEdit) {
            try {
                const oldChannel = interaction.guild.channels.cache.get(menu.channelId);
                if (oldChannel && oldChannel.isTextBased()) {
                    const oldMessage = await oldChannel.messages.fetch(menu.messageId).catch(() => null);
                    if (oldMessage) {
                        await oldMessage.delete();
                        console.log(`Deleted old published message for menu ${menuId}.`);
                    }
                }
            } catch (error) {
                console.log(`Couldn't delete old message for menu ${menuId}, probably already deleted. Error: ${error.message}`);
            }
        }

        let message;
        const botDisplayName = client.user.displayName || client.user.username;
        const botAvatarURL = client.user.displayAvatarURL();

        // Publish or edit the message
        if (messageToEdit) {
            if (menu.useWebhook) {
                try {
                    const webhook = await getOrCreateWebhook(channel);
                    await webhook.editMessage(messageToEdit.id, {
                        embeds: [embed],
                        components,
                        username: menu.webhookName || botDisplayName,
                        avatarURL: menu.webhookAvatar || botAvatarURL,
                    });
                    message = messageToEdit;
                } catch (webhookError) {
                    console.error("Webhook edit failed, falling back to regular edit:", webhookError);
                    message = await messageToEdit.edit({ embeds: [embed], components });
                }
            } else {
                message = await messageToEdit.edit({ embeds: [embed], components });
            }
        } else if (menu.useWebhook) {
            try {
                const webhook = await getOrCreateWebhook(channel);
                message = await webhook.send({
                    embeds: [embed],
                    components,
                    username: menu.webhookName || botDisplayName,
                    avatarURL: menu.webhookAvatar || botAvatarURL,
                });
            } catch (webhookError) {
                console.error("Webhook send failed, falling back to regular send:", webhookError);
                message = await channel.send({ embeds: [embed], components });
            }
        } else {
            message = await channel.send({ embeds: [embed], components });
        }

        // Save message information
        await db.saveMessageId(menuId, channel.id, message.id);
        
        await interaction.editReply({
            content: `✅ Menu published successfully using ${menu.useWebhook ? "WEBHOOK" : "BOT"}!${invalidRoles.length > 0 ? `\n⚠️ Warning: ${invalidRoles.length} invalid roles were removed from the menu.` : ''}`,
            flags: MessageFlags.Ephemeral
        });
        
        return showMenuConfiguration(interaction, menuId);
        
    } catch (error) {
        console.error("Publishing error:", error);
        let errorMsg = "❌ Failed to publish menu. ";

        if (error.code === 50013) {
            errorMsg += "Bot lacks permissions. Required: 'Manage Webhooks' and 'Send Messages' in the channel, and 'Manage Roles' in the guild.";
        } else if (error.code === 50035) {
            errorMsg += "Invalid component data. Please check your role configurations and emoji formats.";
        } else if (error.code === 50001) {
            errorMsg += "Missing access to the channel. Please check permissions.";
        } else if (error.message?.includes("ENOENT") || error.message?.includes("Invalid Form Body")) {
            errorMsg += "Invalid image URL or resource not found. Please check your embed/webhook settings.";
        } else {
            errorMsg += error.message || "Unknown error occurred.";
        }

        await interaction.editReply({ content: errorMsg, flags: MessageFlags.Ephemeral });
    }
}

// Bot login
client.login(process.env.TOKEN).catch(error => {
    console.error("Failed to login:", error);
    process.exit(1);
});
