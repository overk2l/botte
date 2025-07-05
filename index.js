/*
 * Discord Bot - Comprehensive Menu Management System
 * 
 * RECENT FIXES (Applied):
 * - Fixed "infinite thinking" and "InteractionNotReplied" errors in hybrid menu system
 * - Added comprehensive error handling and timeout management for all hybrid menu interactions
 * - Implemented proper interaction deferral and reply logic for hybrid menu buttons and select menus
 * - Added robust error recovery and debug logging for hybrid menu operations
 * - Enhanced interaction flow to prevent timeout issues
 * - Added configuration interaction exclusions to prevent deferral conflicts
 * - Improved role selection and display type configuration handlers
 * - Added timeout clearing mechanism for all hybrid menu operations
 * - Enhanced select menu handlers with error handling and debug logging
 * 
 * All hybrid menu actions should now respond immediately with proper user feedback
 * and no more infinite thinking or unhandled interaction errors.
 */

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

// Node.js File System Imports
const fs = require('fs').promises;
const path = require('path');

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

// Performance Metrics System
const performanceMetrics = {
  interactions: {
    total: 0,
    successful: 0,
    failed: 0,
    averageResponseTime: 0,
    responseTimes: []
  },
  menus: {
    created: 0,
    published: 0,
    interactions: 0
  },
  health: {
    uptime: 0,
    memoryUsage: 0,
    lastCheck: Date.now()
  }
};

// Track interaction performance
function trackInteractionPerformance(interaction, startTime, success) {
  const responseTime = Date.now() - startTime;
  
  performanceMetrics.interactions.total++;
  if (success) {
    performanceMetrics.interactions.successful++;
  } else {
    performanceMetrics.interactions.failed++;
  }
  
  performanceMetrics.interactions.responseTimes.push(responseTime);
  
  // Keep only last 100 response times to prevent memory issues
  if (performanceMetrics.interactions.responseTimes.length > 100) {
    performanceMetrics.interactions.responseTimes.shift();
  }
  
  // Calculate average response time
  const sum = performanceMetrics.interactions.responseTimes.reduce((a, b) => a + b, 0);
  performanceMetrics.interactions.averageResponseTime = sum / performanceMetrics.interactions.responseTimes.length;
}

// Track menu usage
function trackMenuUsage(menuId, type) {
  performanceMetrics.menus.interactions++;
  console.log(`Menu usage tracked: ${type} menu ${menuId}`);
}

// Track page views
function trackPageView(pageId) {
  console.log(`Page view tracked: ${pageId}`);
}

// Update bot health metrics
function updateBotHealth() {
  const used = process.memoryUsage();
  performanceMetrics.health.memoryUsage = Math.round(used.heapUsed / 1024 / 1024 * 100) / 100; // MB
  performanceMetrics.health.uptime = process.uptime();
  performanceMetrics.health.lastCheck = Date.now();
}

// Get performance metrics
function getPerformanceMetrics() {
  return performanceMetrics;
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
    // Look for existing webhook with the same name and owned by the bot
    const existing = webhooks.find(w => w.owner && w.owner.id === channel.client.user.id && w.name === name);

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

  // Scheduled Messages Methods
  saveScheduledMessage(scheduleData) {
    if (!firebaseEnabled) return;
    
    try {
      const scheduledRef = doc(dbFirestore, "artifacts", appId, "public", "data", "scheduled_messages", scheduleData.id);
      setDoc(scheduledRef, scheduleData);
    } catch (error) {
      console.error("Error saving scheduled message:", error);
    }
  },

  async getScheduledMessages() {
    if (!firebaseEnabled) return Array.from(scheduledMessages.values());
    
    try {
      const { collection, getDocs } = require('firebase/firestore');
      const scheduledRef = collection(dbFirestore, "artifacts", appId, "public", "data", "scheduled_messages");
      const snapshot = await getDocs(scheduledRef);
      
      const schedules = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        schedules.push(data);
        // Also load into memory for runtime access
        scheduledMessages.set(doc.id, data);
      });
      
      return schedules;
    } catch (error) {
      console.error("Error getting scheduled messages:", error);
      return Array.from(scheduledMessages.values());
    }
  },

  deleteScheduledMessage(scheduleId) {
    if (!firebaseEnabled) return;
    
    try {
      const scheduledRef = doc(dbFirestore, "artifacts", appId, "public", "data", "scheduled_messages", scheduleId);
      deleteDoc(scheduledRef);
    } catch (error) {
      console.error("Error deleting scheduled message:", error);
    }
  },

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
      memberCountOptions: {
        showInDropdowns: false,
        showInButtons: false
      }, // Granular control over where member counts appear
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

  // ======================= Information Menu Functions =======================

  /**
   * Map to store guildId -> [infoMenuId, ...] for quick lookup of info menus per guild
   */
  infoMenus: new Map(),
  
  /**
   * Map to store infoMenuId -> infoMenuObject for quick access to info menu data
   */
  infoMenuData: new Map(),

  /**
   * Map to store guildId -> [hybridMenuId, ...] for quick lookup of hybrid menus per guild
   */
  hybridMenus: new Map(),
  
  /**
   * Map to store hybridMenuId -> hybridMenuObject for quick access to hybrid menu data
   */
  hybridMenuData: new Map(),

  /**
   * Loads all information menus from Firestore into memory.
   */
  async loadAllInfoMenus() {
    console.log("[Database] Loading all info menus...");
    if (!firebaseEnabled) {
      console.warn("[Database] Running in memory-only mode for info menus. Data will not persist between restarts.");
      return;
    }
    try {
      const infoMenusCollectionRef = collection(dbFirestore, `artifacts/${appId}/public/data/info_menus`);
      const querySnapshot = await getDocs(infoMenusCollectionRef);
      this.infoMenus.clear();
      this.infoMenuData.clear();

      querySnapshot.forEach(doc => {
        const infoMenu = doc.data();
        const infoMenuId = doc.id;
        const guildId = infoMenu.guildId;

        if (!this.infoMenus.has(guildId)) {
          this.infoMenus.set(guildId, []);
        }
        this.infoMenus.get(guildId).push(infoMenuId);
        this.infoMenuData.set(infoMenuId, infoMenu);
      });
      console.log(`[Database] Loaded ${this.infoMenuData.size} info menus from Firestore.`);
    } catch (error) {
      if (error.code === 'permission-denied') {
        console.warn("[Database] Firebase permissions not configured for info menus. Trying local backup...");
      } else {
        console.error("[Database] Error loading info menus:", error);
        console.log("[Database] Trying local backup...");
      }
      
      // Try to load from local backup file
      const loadedFromBackup = await loadInfoMenusFromLocalFile();
      if (!loadedFromBackup) {
        console.warn("[Database] No local backup found. Running in memory-only mode.");
      }
    }
  },

  /**
   * Creates a new information menu and saves it to Firestore.
   * @param {string} guildId - The ID of the guild where the info menu is created.
   * @param {string} name - The name of the info menu.
   * @param {string} desc - The description for the info menu.
   * @returns {Promise<string>} The ID of the newly created info menu.
   */
  async createInfoMenu(guildId, name, desc) {
    const id = 'info_' + Date.now().toString() + Math.floor(Math.random() * 1000).toString();
    const newInfoMenu = {
      guildId,
      name,
      desc,
      selectionType: [], // Array of 'dropdown' and/or 'button'
      pages: [], // Array of page objects: { id, name, content }
      channelId: null,
      messageId: null,
      useWebhook: false,
      webhookName: null,
      webhookAvatar: null,
      embedColor: '#5865F2',
      embedThumbnail: null,
      embedImage: null,
      embedAuthorName: null,
      embedAuthorIconURL: null,
      embedFooterText: null,
      embedFooterIconURL: null,
      isTemplate: false,
      templateName: null,
      templateDescription: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to in-memory storage
    if (!this.infoMenus.has(guildId)) {
      this.infoMenus.set(guildId, []);
    }
    this.infoMenus.get(guildId).push(id);
    this.infoMenuData.set(id, newInfoMenu);

    if (firebaseEnabled) {
      try {
        // Filter out undefined values for Firestore
        const cleanedMenu = Object.fromEntries(
          Object.entries(newInfoMenu).filter(([key, value]) => value !== undefined)
        );
        
        const infoMenuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/info_menus`, id);
        await setDoc(infoMenuDocRef, cleanedMenu);
        console.log(`[Database] Created info menu with ID: ${id} in Firestore`);
        // Also save local backup
        await saveInfoMenusToLocalFile();
      } catch (error) {
        if (error.code === 'permission-denied') {
          console.warn(`[Database] Firebase permissions not configured for info menus. Menu ${id} created in memory only.`);
        } else {
          console.error(`[Database] Error creating info menu ${id} in Firestore:`, error);
        }
        // Save to local file as backup
        await saveInfoMenusToLocalFile();
      }
    } else {
      console.log(`[Database] Created info menu with ID: ${id} (memory only)`);
      // Save to local file as backup when Firebase is disabled
      await saveInfoMenusToLocalFile();
    }

    return id;
  },

  /**
   * Gets all information menus for a specific guild.
   * @param {string} guildId - The guild ID to get info menus for.
   * @returns {Array} Array of info menu objects.
   */
  getInfoMenus(guildId) {
    if (!guildId) {
      // Return all templates if no guildId provided
      return Array.from(this.infoMenuData.values())
        .filter(menu => menu.isTemplate)
        .map(menu => ({ id: Array.from(this.infoMenuData.keys()).find(key => this.infoMenuData.get(key) === menu), ...menu }));
    }
    const menuIds = this.infoMenus.get(guildId) || [];
    return menuIds.map(id => ({ id, ...this.infoMenuData.get(id) })).filter(Boolean);
  },

  /**
   * Gets a specific information menu by ID.
   * @param {string} infoMenuId - The ID of the info menu to retrieve.
   * @returns {Object|null} The info menu object or null if not found.
   */
  getInfoMenu(infoMenuId) {
    return this.infoMenuData.get(infoMenuId) || null;
  },

  /**
   * Updates an information menu with new data.
   * @param {string} infoMenuId - The ID of the info menu to update.
   * @param {Object} updateData - The data to update.
   */
  async updateInfoMenu(infoMenuId, updateData) {
    if (!infoMenuId || typeof infoMenuId !== 'string') {
      console.warn(`[Database] Invalid infoMenuId provided to updateInfoMenu: ${infoMenuId}`);
      return;
    }

    const existingMenu = this.infoMenuData.get(infoMenuId);
    if (!existingMenu) {
      console.warn(`[Database] Attempted to update non-existent info menu: ${infoMenuId}`);
      return;
    }

    // Update in-memory data
    const updatedMenu = { 
      ...existingMenu, 
      ...updateData, 
      updatedAt: new Date().toISOString() 
    };
    this.infoMenuData.set(infoMenuId, updatedMenu);

    if (firebaseEnabled) {
      try {
        // Filter out undefined values for Firestore
        const cleanedMenu = Object.fromEntries(
          Object.entries(updatedMenu).filter(([key, value]) => value !== undefined)
        );
        
        const infoMenuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/info_menus`, infoMenuId);
        await setDoc(infoMenuDocRef, cleanedMenu);
        console.log(`[Database] Updated info menu ${infoMenuId} in Firestore`);
        // Also save local backup
        await saveInfoMenusToLocalFile();
      } catch (error) {
        if (error.code === 'permission-denied') {
          console.warn(`[Database] Firebase permissions not configured for info menus. Menu ${infoMenuId} updated in memory only.`);
        } else {
          console.error(`[Database] Error updating info menu ${infoMenuId} in Firestore:`, error);
        }
        // Save to local file as backup
        await saveInfoMenusToLocalFile();
      }
    } else {
      console.log(`[Database] Updated info menu ${infoMenuId} (memory only)`);
      // Save to local file as backup when Firebase is disabled
      await saveInfoMenusToLocalFile();
    }
  },

  /**
   * Saves the message ID and channel ID for a published information menu.
   * @param {string} infoMenuId - The ID of the info menu.
   * @param {string} channelId - The channel ID where the menu was published.
   * @param {string} messageId - The message ID of the published menu.
   */
  async saveInfoMenuMessage(infoMenuId, channelId, messageId) {
    await this.updateInfoMenu(infoMenuId, { channelId, messageId });
  },

  /**
   * Adds or updates a page in an information menu.
   * @param {string} infoMenuId - The ID of the info menu.
   * @param {Object} pageData - The page data: { id?, name, content }
   */
  async saveInfoMenuPage(infoMenuId, pageData) {
    const menu = this.getInfoMenu(infoMenuId);
    if (!menu) return;

    const pages = [...(menu.pages || [])];
    const pageId = pageData.id || `page_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    const existingIndex = pages.findIndex(p => p.id === pageId);
    const newPage = { id: pageId, ...pageData };
    
    if (existingIndex >= 0) {
      pages[existingIndex] = newPage;
    } else {
      pages.push(newPage);
    }

    await this.updateInfoMenu(infoMenuId, { pages });
    return pageId;
  },

  /**
   * Removes a page from an information menu.
   * @param {string} infoMenuId - The ID of the info menu.
   * @param {string} pageId - The ID of the page to remove.
   */
  async removeInfoMenuPage(infoMenuId, pageId) {
    const menu = this.getInfoMenu(infoMenuId);
    if (!menu) return;

    const pages = (menu.pages || []).filter(p => p.id !== pageId);
    await this.updateInfoMenu(infoMenuId, { pages });
  },

  /**
   * Deletes an information menu from both memory and Firestore.
   * @param {string} infoMenuId - The ID of the info menu to delete.
   */
  async deleteInfoMenu(infoMenuId) {
    if (!infoMenuId || typeof infoMenuId !== 'string') {
      console.warn(`[Database] Invalid infoMenuId provided to deleteInfoMenu: ${infoMenuId}`);
      return;
    }

    const menu = this.infoMenuData.get(infoMenuId);
    if (!menu) {
      console.warn(`[Database] Attempted to delete non-existent info menu: ${infoMenuId}`);
      return;
    }

    // Remove from in-memory maps
    const guildMenus = this.infoMenus.get(menu.guildId);
    if (guildMenus) {
      const index = guildMenus.indexOf(infoMenuId);
      if (index > -1) {
        guildMenus.splice(index, 1);
      }
      // Clean up empty guild arrays
      if (guildMenus.length === 0) {
        this.infoMenus.delete(menu.guildId);
      }
    }
    this.infoMenuData.delete(infoMenuId);

    if (firebaseEnabled) {
      try {
        const infoMenuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/info_menus`, infoMenuId);
        await deleteDoc(infoMenuDocRef);
        console.log(`[Database] Deleted info menu with ID: ${infoMenuId} from Firestore`);
        // Also update local backup
        await saveInfoMenusToLocalFile();
      } catch (error) {
        console.error(`[Database] Error deleting info menu ${infoMenuId} in Firestore:`, error);
        // Update local backup even if Firebase fails
        await saveInfoMenusToLocalFile();
      }
    } else {
      console.log(`[Database] Deleted info menu with ID: ${infoMenuId} (memory only)`);
      // Save to local file as backup when Firebase is disabled
      await saveInfoMenusToLocalFile();
    }
  },

  /**
   * Creates an info menu from a template.
   * @param {string} templateId - The ID of the template to copy from.
   * @param {string} guildId - The guild ID for the new menu.
   * @param {string} name - The name for the new menu.
   * @param {string} desc - The description for the new menu.
   * @returns {Promise<string>} The ID of the newly created menu.
   */
  async createInfoMenuFromTemplate(templateId, guildId, name, desc) {
    const template = this.getInfoMenu(templateId);
    if (!template || !template.isTemplate) {
      throw new Error('Template not found or invalid');
    }

    const newId = await this.createInfoMenu(guildId, name, desc);
    
    // Copy template data (excluding guild-specific and ID fields)
    const templateData = {
      selectionType: template.selectionType,
      pages: template.pages ? template.pages.map(page => ({ ...page })) : [],
      useWebhook: template.useWebhook,
      webhookName: template.webhookName,
      webhookAvatar: template.webhookAvatar,
      embedColor: template.embedColor,
      embedThumbnail: template.embedThumbnail,
      embedImage: template.embedImage,
      embedAuthorName: template.embedAuthorName,
      embedAuthorIconURL: template.embedAuthorIconURL,
      embedFooterText: template.embedFooterText,
      embedFooterIconURL: template.embedFooterIconURL
    };

    await this.updateInfoMenu(newId, templateData);
    return newId;
  },

  /**
   * Gets all pages for an information menu.
   * @param {string} infoMenuId - The ID of the info menu.
   * @returns {Array} Array of page objects.
   */
  getInfoMenuPages(infoMenuId) {
    const menu = this.getInfoMenu(infoMenuId);
    return menu ? (menu.pages || []) : [];
  },

  /**
   * Gets a specific page from an information menu.
   * @param {string} infoMenuId - The ID of the info menu.
   * @param {string} pageId - The ID of the page.
   * @returns {Object|null} The page object or null if not found.
   */
getInfoMenuPage(infoMenuId, pageId) {
  const pages = this.getInfoMenuPages(infoMenuId);
  return pages.find(page => page.id === pageId) || null;
},

/**
 * Updates a specific page in an information menu.
 * @param {string} infoMenuId - The ID of the info menu.
 * @param {string} pageId - The ID of the page to update.
 * @param {Object} pageData - The updated page data.
 * @returns {boolean} True if updated successfully, false otherwise.
 */
updateInfoMenuPage(infoMenuId, pageId, pageData) {
  const menu = this.getInfoMenu(infoMenuId);
  if (!menu) return false;
  
  const pageIndex = menu.pages.findIndex(page => page.id === pageId);
  if (pageIndex === -1) return false;
  
  // Update the page
  menu.pages[pageIndex] = { ...menu.pages[pageIndex], ...pageData };
  
  // Save to memory
  this.infoMenuData.set(infoMenuId, menu);
  
  // Save to Firestore if available
  if (firebaseEnabled) {
    const db = getFirestore();
    const menuRef = doc(db, 'infoMenus', infoMenuId);
    setDoc(menuRef, menu, { merge: true }).catch(error => {
      console.error(`[Database] Error updating info menu page ${pageId} in Firestore:`, error);
    });
  }
  
  // Save to local backup
  saveInfoMenusToLocalFile();
  
  return true;
},

/**
 * Adds a new page to an information menu.
 * @param {string} infoMenuId - The ID of the info menu.
 * @param {Object} pageData - The page data to add.
 * @returns {boolean} True if added successfully, false otherwise.
 */
addInfoMenuPage(infoMenuId, pageData) {
  const menu = this.getInfoMenu(infoMenuId);
  if (!menu) return false;
  
  // Add the page
  menu.pages.push(pageData);
  
  // Save to memory
  this.infoMenuData.set(infoMenuId, menu);
  
  // Save to Firestore if available
  if (firebaseEnabled) {
    const db = getFirestore();
    const menuRef = doc(db, 'infoMenus', infoMenuId);
    setDoc(menuRef, menu, { merge: true }).catch(error => {
      console.error(`[Database] Error adding info menu page to Firestore:`, error);
    });
  }
  
  // Save to local backup
  saveInfoMenusToLocalFile();
  
  return true;
},

// ======================= Hybrid Menu Functions =======================

/**
 * Loads all hybrid menus from Firestore into memory.
 */
async loadAllHybridMenus() {
  console.log("[Database] Loading all hybrid menus...");
  if (!firebaseEnabled) {
    console.warn("[Database] Running in memory-only mode for hybrid menus. Data will not persist between restarts.");
    return;
  }
  try {
    const hybridMenusCollectionRef = collection(dbFirestore, `artifacts/${appId}/public/data/hybrid_menus`);
    const querySnapshot = await getDocs(hybridMenusCollectionRef);
    this.hybridMenus.clear();
    this.hybridMenuData.clear();

    querySnapshot.forEach(doc => {
      const hybridMenuData = doc.data();
      const hybridMenuId = doc.id;
      const guildId = hybridMenuData.guildId;

      if (!this.hybridMenus.has(guildId)) {
        this.hybridMenus.set(guildId, []);
      }
      this.hybridMenus.get(guildId).push(hybridMenuId);
      this.hybridMenuData.set(hybridMenuId, hybridMenuData);
    });
    console.log(`[Database] Loaded ${this.hybridMenuData.size} hybrid menus from Firestore.`);
  } catch (error) {
    if (error.code === 'permission-denied') {
      console.warn("[Database] Permission denied when loading hybrid menus from Firestore. Using local fallback.");
    } else {
      console.error("[Database] Error loading hybrid menus from Firestore:", error);
    }
    
    // Try to load from local backup file
    const loadedFromBackup = await loadHybridMenusFromLocalFile();
    if (!loadedFromBackup) {
      console.warn("[Database] No local backup found. Starting with empty hybrid menus.");
    }
  }
},

/**
 * Creates a new hybrid menu and saves it to Firestore.
 * @param {string} guildId - The ID of the guild where the hybrid menu is created.
 * @param {string} name - The name of the hybrid menu.
 * @param {string} desc - The description for the hybrid menu.
 * @returns {Promise<string>} The ID of the newly created hybrid menu.
 */
async createHybridMenu(guildId, name, desc) {
  console.log(`[Database] Creating hybrid menu for guild ${guildId} with name: "${name}"`);
  
  const id = 'hybrid_' + Date.now().toString() + Math.floor(Math.random() * 1000).toString();
  console.log(`[Database] Generated hybrid menu ID: ${id}`);
  
  const newHybridMenu = {
    guildId,
    name,
    desc,
    // Information menu properties
    infoSelectionType: [], // Array of 'dropdown' and/or 'button' for info (legacy)
    defaultInfoDisplayType: 'dropdown', // New field for info pages default
    pages: [], // Array of page objects: { id, name, content }
    // Reaction role properties
    roleSelectionType: [], // Array of 'dropdown' and/or 'button' for roles (legacy)
    defaultRoleDisplayType: 'dropdown', // New field for roles default
    dropdownRoles: [],
    buttonRoles: [],
    dropdownEmojis: {},
    buttonEmojis: {},
    buttonColors: {},
    regionalLimits: {},
    exclusionMap: {},
    maxRolesLimit: null,
    successMessageAdd: "✅ You now have the role <@&{roleId}>!",
    successMessageRemove: "✅ You removed the role <@&{roleId}>!",
    limitExceededMessage: "❌ You have reached the maximum number of roles for this menu or region.",
    dropdownRoleOrder: [],
    buttonRoleOrder: [],
    dropdownRoleDescriptions: {},
    // Common properties
    channelId: null,
    messageId: null,
    useWebhook: false,
    webhookName: null,
    webhookAvatar: null,
    embedColor: '#5865F2',
    embedThumbnail: null,
    embedImage: null,
    embedAuthorName: null,
    embedAuthorIconURL: null,
    embedFooterText: null,
    embedFooterIconURL: null,
    showMemberCounts: false,
    memberCountOptions: {
      showInDropdowns: false,
      showInButtons: false
    }, // Granular control over where member counts appear
    isTemplate: false,
    templateName: null,
    templateDescription: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  console.log(`[Database] Hybrid menu object created, saving to memory...`);
  
  // Save to in-memory storage
  if (!this.hybridMenus.has(guildId)) {
    this.hybridMenus.set(guildId, []);
  }
  this.hybridMenus.get(guildId).push(id);
  this.hybridMenuData.set(id, newHybridMenu);
  
  console.log(`[Database] Hybrid menu saved to memory. Firebase enabled: ${firebaseEnabled}`);

  if (firebaseEnabled) {
    try {
      console.log(`[Database] Attempting to save hybrid menu to Firestore...`);
      const hybridMenuRef = doc(dbFirestore, `artifacts/${appId}/public/data/hybrid_menus`, id);
      await setDoc(hybridMenuRef, newHybridMenu);
      console.log(`[Database] Created hybrid menu with ID: ${id} (saved to Firestore)`);
      // Also save local backup
      await saveHybridMenusToLocalFile();
    } catch (error) {
      console.error(`[Database] Error creating hybrid menu in Firestore:`, error);
      console.error(`[Database] Error details:`, error.message);
      console.error(`[Database] Error code:`, error.code);
      // Continue with in-memory storage only
    }
  } else {
    console.log(`[Database] Created hybrid menu with ID: ${id} (memory only)`);
    // Save to local file as backup when Firebase is disabled
    await saveHybridMenusToLocalFile();
  }

  console.log(`[Database] Hybrid menu creation completed, returning ID: ${id}`);
  return id;
},

/**
 * Gets all hybrid menus for a specific guild.
 * @param {string} guildId - The guild ID to get hybrid menus for.
 * @returns {Array} Array of hybrid menu objects.
 */
getHybridMenus(guildId) {
  if (!guildId) {
    // Return all templates if no guildId provided
    return Array.from(this.hybridMenuData.values())
      .filter(menu => menu.isTemplate)
      .map(menu => ({ id: Array.from(this.hybridMenuData.keys()).find(key => this.hybridMenuData.get(key) === menu), ...menu }));
  }
  const menuIds = this.hybridMenus.get(guildId) || [];
  return menuIds.map(id => ({ id, ...this.hybridMenuData.get(id) })).filter(Boolean);
},

/**
 * Gets a specific hybrid menu by ID.
 * @param {string} hybridMenuId - The ID of the hybrid menu to retrieve.
 * @returns {Object|null} The hybrid menu object or null if not found.
 */
getHybridMenu(hybridMenuId) {
  return this.hybridMenuData.get(hybridMenuId) || null;
},

/**
 * Updates a hybrid menu with new data.
 * @param {string} hybridMenuId - The ID of the hybrid menu to update.
 * @param {Object} updateData - The data to update.
 */
async updateHybridMenu(hybridMenuId, updateData) {
  if (!hybridMenuId || typeof hybridMenuId !== 'string') {
    console.warn(`[Database] Invalid hybridMenuId provided to updateHybridMenu: ${hybridMenuId}`);
    return;
  }

  const existingMenu = this.hybridMenuData.get(hybridMenuId);
  if (!existingMenu) {
    console.warn(`[Database] Attempted to update non-existent hybrid menu: ${hybridMenuId}`);
    return;
  }

  // Update in-memory data
  const updatedMenu = { 
    ...existingMenu, 
    ...updateData, 
    updatedAt: new Date().toISOString() 
  };
  this.hybridMenuData.set(hybridMenuId, updatedMenu);

  if (firebaseEnabled) {
    try {
      const hybridMenuRef = doc(dbFirestore, `artifacts/${appId}/public/data/hybrid_menus`, hybridMenuId);
      await setDoc(hybridMenuRef, updatedMenu, { merge: true });
      console.log(`[Database] Updated hybrid menu ${hybridMenuId} in Firestore.`);
    } catch (error) {
      console.error(`[Database] Error updating hybrid menu in Firestore:`, error);
    }
  } else {
    console.log(`[Database] Updated hybrid menu ${hybridMenuId} (memory only)`);
    // Save to local file as backup when Firebase is disabled
    await saveHybridMenusToLocalFile();
  }
},

/**
 * Saves the message ID and channel ID for a published hybrid menu.
 * @param {string} hybridMenuId - The ID of the hybrid menu.
 * @param {string} channelId - The channel ID where the menu was published.
 * @param {string} messageId - The message ID of the published menu.
 */
async saveHybridMenuMessage(hybridMenuId, channelId, messageId) {
  await this.updateHybridMenu(hybridMenuId, { channelId, messageId });
},

/**
 * Deletes a hybrid menu from both memory and Firestore.
 * @param {string} hybridMenuId - The ID of the hybrid menu to delete.
 */
async deleteHybridMenu(hybridMenuId) {
  if (!hybridMenuId || typeof hybridMenuId !== 'string') {
    console.warn(`[Database] Invalid hybridMenuId provided to deleteHybridMenu: ${hybridMenuId}`);
    return;
  }

  const menu = this.hybridMenuData.get(hybridMenuId);
  if (!menu) {
    console.warn(`[Database] Attempted to delete non-existent hybrid menu: ${hybridMenuId}`);
    return;
  }

  // Remove from in-memory maps
  const guildMenus = this.hybridMenus.get(menu.guildId);
  if (guildMenus) {
    const index = guildMenus.indexOf(hybridMenuId);
    if (index > -1) {
      guildMenus.splice(index, 1);
    }
    // Clean up empty guild arrays
    if (guildMenus.length === 0) {
      this.hybridMenus.delete(menu.guildId);
    }
  }
  this.hybridMenuData.delete(hybridMenuId);

  if (firebaseEnabled) {
    try {
      const hybridMenuRef = doc(dbFirestore, `artifacts/${appId}/public/data/hybrid_menus`, hybridMenuId);
      await deleteDoc(hybridMenuRef);
      console.log(`[Database] Deleted hybrid menu with ID: ${hybridMenuId} from Firestore.`);
    } catch (error) {
      console.error(`[Database] Error deleting hybrid menu from Firestore:`, error);
    }
  } else {
    console.log(`[Database] Deleted hybrid menu with ID: ${hybridMenuId} (memory only)`);
    // Save to local file as backup when Firebase is disabled
    await saveHybridMenusToLocalFile();
  }
}

};

// Local file backup system for info menus (fallback when Firebase fails)
const LOCAL_BACKUP_DIR = path.join(__dirname, 'data');
const INFO_MENUS_BACKUP_FILE = path.join(LOCAL_BACKUP_DIR, 'info_menus_backup.json');
const HYBRID_MENUS_BACKUP_FILE = path.join(LOCAL_BACKUP_DIR, 'hybrid_menus_backup.json');

/**
 * Saves info menus to local file as backup
 */
async function saveInfoMenusToLocalFile() {
  try {
    // Ensure data directory exists
    await fs.mkdir(LOCAL_BACKUP_DIR, { recursive: true });
    
    // Convert Maps to objects for JSON serialization
    const backupData = {
      infoMenus: Object.fromEntries(db.infoMenus),
      infoMenuData: Object.fromEntries(db.infoMenuData),
      timestamp: new Date().toISOString()
    };
    
    await fs.writeFile(INFO_MENUS_BACKUP_FILE, JSON.stringify(backupData, null, 2));
    console.log('[Local Backup] Info menus saved to local file');
  } catch (error) {
    console.error('[Local Backup] Error saving info menus to local file:', error);
  }
}

/**
 * Saves hybrid menus to local file as backup
 */
async function saveHybridMenusToLocalFile() {
  try {
    // Ensure data directory exists
    await fs.mkdir(LOCAL_BACKUP_DIR, { recursive: true });
    
    // Convert Maps to objects for JSON serialization
    const backupData = {
      hybridMenus: Object.fromEntries(db.hybridMenus),
      hybridMenuData: Object.fromEntries(db.hybridMenuData),
      timestamp: new Date().toISOString()
    };
    
    await fs.writeFile(HYBRID_MENUS_BACKUP_FILE, JSON.stringify(backupData, null, 2));
    console.log('[Local Backup] Hybrid menus saved to local file');
  } catch (error) {
    console.error('[Local Backup] Error saving hybrid menus to local file:', error);
  }
}

/**
 * Loads info menus from local file backup
 */
async function loadInfoMenusFromLocalFile() {
  try {
    const data = await fs.readFile(INFO_MENUS_BACKUP_FILE, 'utf8');
    const backupData = JSON.parse(data);
    
    // Restore Maps from objects
    db.infoMenus.clear();
    db.infoMenuData.clear();
    
    if (backupData.infoMenus) {
      Object.entries(backupData.infoMenus).forEach(([key, value]) => {
        db.infoMenus.set(key, value);
      });
    }
    
    if (backupData.infoMenuData) {
      Object.entries(backupData.infoMenuData).forEach(([key, value]) => {
        db.infoMenuData.set(key, value);
      });
    }
    
    console.log(`[Local Backup] Loaded ${db.infoMenuData.size} info menus from local file (backup from ${backupData.timestamp})`);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[Local Backup] Error loading info menus from local file:', error);
    }
    return false;
  }
}

/**
 * Loads hybrid menus from local file backup
 */
async function loadHybridMenusFromLocalFile() {
  try {
    const data = await fs.readFile(HYBRID_MENUS_BACKUP_FILE, 'utf8');
    const backupData = JSON.parse(data);
    
    // Restore Maps from objects
    db.hybridMenus.clear();
    db.hybridMenuData.clear();
    
    if (backupData.hybridMenus) {
      Object.entries(backupData.hybridMenus).forEach(([key, value]) => {
        db.hybridMenus.set(key, value);
      });
    }
    
    if (backupData.hybridMenuData) {
      Object.entries(backupData.hybridMenuData).forEach(([key, value]) => {
        db.hybridMenuData.set(key, value);
      });
    }
    
    console.log(`[Local Backup] Loaded ${db.hybridMenuData.size} hybrid menus from local file (backup from ${backupData.timestamp})`);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[Local Backup] Error loading hybrid menus from local file:', error);
    }
    return false;
  }
}

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
async function updatePublishedMessageComponents(interaction, menu, menuId, forceUpdate = false) {
    // Always rebuild components to reset dropdown selections for better UX
    // But only actually update the message if there are meaningful changes to show
    
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

        // Check if we need to show member counts, which would require a message update
        const shouldShowMemberCounts = menu.showMemberCounts;
        
        // Always rebuild components to reset dropdown selections
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
                
                // Get member count if enabled for dropdowns
                const memberCountOptions = menu.memberCountOptions || {};
                const showCountsInDropdowns = memberCountOptions.showInDropdowns || (menu.showMemberCounts && !memberCountOptions.showInButtons);
                const memberCount = showCountsInDropdowns ? role.members.size : null;
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

                // Get member count if enabled for buttons
                const memberCountOptions = menu.memberCountOptions || {};
                const showCountsInButtons = memberCountOptions.showInButtons || (menu.showMemberCounts && !memberCountOptions.showInDropdowns);
                const memberCount = showCountsInButtons ? role.members.size : null;
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

        // Only update the message if we're showing member counts or if explicitly forced
        // This prevents unnecessary "edited" marks while still resetting dropdown selections
        if (shouldShowMemberCounts || forceUpdate) {
            const publishedEmbed = await createReactionRoleEmbed(guild, menu);

            // Edit the message
            if (menu.useWebhook) {
                try {
                    const webhookName = menu.webhookName || "Reaction Role Webhook";
                    const webhook = await getOrCreateWebhook(originalChannel, webhookName);
                    await webhook.editMessage(originalMessage.id, {
                        embeds: [publishedEmbed],
                        components,
                    });
                } catch (webhookError) {
                    console.error("Error updating via webhook:", webhookError);
                    // Fallback to regular bot message edit
                    await originalMessage.edit({ embeds: [publishedEmbed], components });
                }
            } else {
                await originalMessage.edit({ embeds: [publishedEmbed], components });
            }
        } else {
            // Just update the components to reset dropdown selections without changing the embed
            await originalMessage.edit({ components });
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
  await db.loadAllInfoMenus();
  await db.loadAllHybridMenus();

  // Initialize new features
  initializeScheduledMessages().catch(console.error);
  updateBotHealth();
  
  console.log("🚀 All systems initialized successfully!");

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
  db.infoMenus.clear();
  db.infoMenuData.clear();
  
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
  const interactionStartTime = Date.now();
  let interactionSuccess = true;
  
  // Log all interactions for debugging
  console.log(`[Interaction] Received: ${interaction.type} - ${interaction.isModalSubmit() ? 'Modal:' + interaction.customId : interaction.isButton() ? 'Button:' + interaction.customId : interaction.isStringSelectMenu() ? 'SelectMenu:' + interaction.customId : interaction.isCommand() ? 'Command:' + interaction.commandName : 'Other'}`);
  
  // Early return for DMs
  if (!interaction.guild) {
    if (interaction.isCommand() || interaction.isButton() || interaction.isStringSelectMenu()) {
      return interaction.reply({ content: "This bot can only be used in servers.", flags: MessageFlags.Ephemeral });
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
    (interaction.isButton() && interaction.customId.startsWith("rr:toggle_member_counts:")) ||
    (interaction.isButton() && interaction.customId === "rr:prompt_raw_embed_json") ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:select_role_for_description:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:select_template")) ||
    // Information menu modal triggers
    (interaction.isButton() && interaction.customId === "info:create") ||
    (interaction.isButton() && interaction.customId === "info:create_from_json") ||
    (interaction.isButton() && interaction.customId.startsWith("info:add_page:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:add_page_custom:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:customize_embed:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:customize_footer:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:save_as_template:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:publish:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:create_from_template:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:reorder_pages:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:toggle_webhook:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:config_webhook:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:clone_menu:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("info:select_template")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("info:page_action:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("info:create_from_template:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("info:select_page_for_description:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("info:select_page_for_button_color:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("info:select_page_for_emoji:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:customize_dropdown_text:")) ||
    // Hybrid menu modal triggers
    (interaction.isButton() && interaction.customId === "hybrid:create") ||
    (interaction.isButton() && interaction.customId === "hybrid:create_from_json") ||
    (interaction.isButton() && interaction.customId.startsWith("hybrid:add_info_page_json:")) ||
    (interaction.isButton() && interaction.customId.startsWith("hybrid:edit_info_page:")) ||
    (interaction.isButton() && interaction.customId.startsWith("hybrid:customize_dropdown_text:")) ||
    (interaction.isButton() && interaction.customId.startsWith("hybrid:webhook_branding:")) ||
    (interaction.isButton() && interaction.customId.startsWith("hybrid:toggle_member_counts:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("hybrid:select_page_display_type:")) ||
    // Scheduled messages modal triggers
    (interaction.isButton() && interaction.customId === "schedule:new") ||
    (interaction.isButton() && interaction.customId.startsWith("schedule:webhook:"))
  );

  // Check if it's a modal submission - these need deferUpdate
  const isModalSubmission = interaction.isModalSubmit();

  // Check if it's a published menu interaction (users interacting with published menus)
  const isPublishedMenuInteraction = (
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("info-menu-select:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info-page:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr-role-select:")) ||
    (interaction.isButton() && interaction.customId.startsWith("rr-role-button:"))
  );

  // Check if it's a published dropdown interaction (should use deferUpdate to prevent "edited" marks)
  const isPublishedDropdownInteraction = (
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("info-menu-select:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr-role-select:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("hybrid-info-select:")) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("hybrid-role-select:"))
  );

  // Check if it's a configuration interaction that should not be deferred
  const isConfigurationInteraction = (
    (interaction.isButton() && interaction.customId.startsWith("info:configure_display:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:cycle_display:")) ||
    (interaction.isButton() && interaction.customId.startsWith("info:add_page_template:"))
  );

  // Check if it's a dashboard navigation that needs immediate handling
  const isDashboardNavigation = (
    (interaction.isButton() && interaction.customId.startsWith("dash:")) ||
    (interaction.isButton() && interaction.customId.startsWith("perf:")) ||
    (interaction.isButton() && interaction.customId.startsWith("schedule:")) ||
    (interaction.isButton() && interaction.customId.startsWith("dynamic:"))
  );

  // Defer non-modal-trigger interactions, but handle dropdown interactions differently
  if (!interaction.replied && !interaction.deferred && !isModalTrigger && !isModalSubmission && !isConfigurationInteraction) {
    try {
      // Use deferUpdate for published dropdown interactions to prevent "edited" marks
      if (isPublishedDropdownInteraction) {
        await interaction.deferUpdate();
      } else {
        // Always defer interactions that need responses
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      console.error("Error deferring reply:", e);
    }
  }

  try {
    console.log(`[Interaction Debug] Starting interaction processing for type: ${interaction.type}, customId: ${interaction.customId || 'N/A'}`);
    
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
        try {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.editReply({ content: "❌ You need Administrator permissions to use the dashboard.", flags: MessageFlags.Ephemeral });
          }
          return await sendMainDashboard(interaction);
        } catch (error) {
          console.error("Error handling dashboard command:", error);
          const errorMessage = "❌ Failed to load dashboard. Please try again.";
          if (interaction.deferred || interaction.replied) {
            return interaction.editReply({ content: errorMessage, flags: MessageFlags.Ephemeral });
          } else {
            return interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
          }
        }
      }
    }

    // Button Handling
    if (interaction.isButton()) {
      console.log(`[Button Debug] Button interaction detected: ${interaction.customId}`);
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];

      console.log(`[Button Debug] Processing button - ctx: ${ctx}, action: ${action}, customId: ${interaction.customId}`);

      let menuId;
      let type;

      if (ctx === "dash") {
        if (action === "reaction-roles") return showReactionRolesDashboard(interaction);
        if (action === "info-menus") return showInfoMenusDashboard(interaction);
        if (action === "hybrid-menus") return showHybridMenusDashboard(interaction);
        if (action === "scheduled-messages") return showScheduledMessagesDashboard(interaction);
        if (action === "performance") return showPerformanceDashboard(interaction);
        if (action === "dynamic-content") return showDynamicContentHelp(interaction);
        if (action === "main") return sendMainDashboard(interaction);
        if (action === "back") return sendMainDashboard(interaction);
      }

      if (ctx === "perf") {
        if (action === "refresh") return showPerformanceDashboard(interaction);
        if (action === "clear") {
          // Clear performance metrics
          performanceMetrics.interactions.total = 0;
          performanceMetrics.interactions.successful = 0;
          performanceMetrics.interactions.failed = 0;
          performanceMetrics.interactions.responseTimes = [];
          performanceMetrics.interactions.averageResponseTime = 0;
          performanceMetrics.menus.created = 0;
          performanceMetrics.menus.published = 0;
          performanceMetrics.menus.interactions = 0;
          
          await interaction.editReply({ content: "✅ Performance metrics cleared!", flags: MessageFlags.Ephemeral });
          // Show updated dashboard after clearing
          setTimeout(async () => {
            try {
              await showPerformanceDashboard(interaction);
            } catch (error) {
              console.error("Error refreshing performance dashboard after clear:", error);
            }
          }, 1000);
          return;
        }
      }

      if (ctx === "schedule") {
        if (action === "refresh") return showScheduledMessagesDashboard(interaction);
        if (action === "new") {
          // Show modal directly for scheduling
          const modal = new ModalBuilder()
            .setCustomId("schedule:modal:create_direct")
            .setTitle("Schedule Message")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("channel_id")
                  .setLabel("Channel ID")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Enter the channel ID where to send the message")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("schedule_time")
                  .setLabel("Schedule Time (optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("2024-12-25 14:30 (leave blank to start now)")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("message_json")
                  .setLabel("Message JSON")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder('{"content": "Hello!", "embeds": [{"title": "Test", "description": "Test message"}]}')
                  .setMaxLength(4000)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("recurring_interval")
                  .setLabel("Recurring Interval (optional)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("daily, weekly, hourly, or minutes (e.g., 30)")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("duration")
                  .setLabel("Auto-delete (minutes, one-time only)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("60 (ignored for recurring messages)")
              )
            );
          
          return interaction.showModal(modal);
        }
        if (action === "manage") return showManageSchedulesMenu(interaction);
        if (action === "back") return showScheduledMessagesDashboard(interaction);
        if (action === "delete") {
          const scheduleId = parts[2];
          const schedule = scheduledMessages.get(scheduleId);
          if (!schedule) {
            return interaction.editReply({ content: "❌ Schedule not found.", flags: MessageFlags.Ephemeral });
          }
          
          // Delete the schedule
          scheduledMessages.delete(scheduleId);
          db.deleteScheduledMessage(scheduleId);
          
          const embed = new EmbedBuilder()
            .setTitle("✅ Schedule Deleted")
            .setDescription("The scheduled message has been successfully deleted.")
            .setColor("#00FF00");
          
          await interaction.editReply({ embeds: [embed], components: [], flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === "toggle") {
          const scheduleId = parts[2];
          const schedule = scheduledMessages.get(scheduleId);
          if (!schedule) {
            return interaction.editReply({ content: "❌ Schedule not found.", flags: MessageFlags.Ephemeral });
          }
          
          // Toggle the schedule status
          schedule.status = schedule.status === 'scheduled' ? 'paused' : 'scheduled';
          scheduledMessages.set(scheduleId, schedule);
          db.saveScheduledMessage(schedule);
          
          const embed = new EmbedBuilder()
            .setTitle("✅ Schedule Updated")
            .setDescription(`The scheduled message has been ${schedule.status === 'scheduled' ? 'activated' : 'deactivated'}.`)
            .setColor("#00FF00");
          
          await interaction.editReply({ embeds: [embed], components: [], flags: MessageFlags.Ephemeral });
          return;
        }
        
        if (action === "webhook") {
          const scheduleId = parts[2];
          const schedule = scheduledMessages.get(scheduleId);
          if (!schedule) {
            // Check if interaction was deferred and handle appropriately
            if (interaction.deferred || interaction.replied) {
              return interaction.editReply({ content: "❌ Schedule not found.", flags: MessageFlags.Ephemeral });
            } else {
              return interaction.reply({ content: "❌ Schedule not found.", flags: MessageFlags.Ephemeral });
            }
          }
          
          // Show webhook configuration modal (only works on non-deferred interactions)
          if (interaction.deferred || interaction.replied) {
            // If already deferred, we can't show a modal, so provide alternative
            return interaction.editReply({ 
              content: "❌ Cannot configure webhook at this time. Please try clicking the Configure Webhook button again.",
              flags: MessageFlags.Ephemeral 
            });
          }
          
          const modal = new ModalBuilder()
            .setCustomId(`schedule:modal:webhook:${scheduleId}`)
            .setTitle("Configure Webhook Settings")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("use_webhook")
                  .setLabel("Use Webhook (yes/no)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setValue(schedule.useWebhook ? "yes" : "no")
                  .setPlaceholder("Enter 'yes' to enable webhook or 'no' to disable")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("webhook_name")
                  .setLabel("Webhook Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(schedule.webhookName || "")
                  .setPlaceholder("Custom name for the webhook (optional)")
                  .setMaxLength(80)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("webhook_avatar")
                  .setLabel("Webhook Avatar URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(schedule.webhookAvatar || "")
                  .setPlaceholder("Custom avatar URL for the webhook (optional)")
              )
            );
          
          return interaction.showModal(modal);
        }
      }

      if (ctx === "hybrid") {
        try {
          console.log(`[Hybrid Debug] Processing action: ${action}`);
          
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure hybrid menus.", "#FF0000", "Permission Denied", false);
          }

          // Handle modal trigger actions (don't defer these)
          const isModalTrigger = (
            action === "create" ||
            action === "create_from_json" ||
            action === "add_info_page_json" ||
            action.startsWith("edit_info_page") ||
            action === "customize_dropdown_text" ||
            action === "webhook_branding" ||
            action === "toggle_member_counts"
          );

          // Defer all non-modal interactions
          if (!isModalTrigger) {
            if (!interaction.deferred && !interaction.replied) {
              await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }
          }

        if (action === "create") {
          console.log(`[Hybrid Debug] Creating modal for new hybrid menu`);
          try {
            const modal = new ModalBuilder()
              .setCustomId("hybrid:modal:create")
              .setTitle("New Hybrid Menu")
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("name")
                    .setLabel("Menu Name")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder("Enter menu name (e.g., 'Server Rules & Roles')")
                    .setMaxLength(100)
                ),
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("desc")
                    .setLabel("Embed Description")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder("Describe your hybrid menu here.")
                    .setMaxLength(4000)
                )
              );
            console.log(`[Hybrid Debug] Modal created, showing to user`);
            return interaction.showModal(modal);
          } catch (error) {
            console.error(`[Hybrid Debug] Error creating or showing modal:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error creating hybrid menu form. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "create_from_json") {
          console.log(`[Hybrid Debug] Creating JSON modal for new hybrid menu`);
          try {
            const modal = new ModalBuilder()
              .setCustomId("hybrid:modal:create_from_json")
              .setTitle("Create Hybrid Menu from JSON")
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("json_data")
                    .setLabel("Raw JSON Data")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Paste your JSON from Discohook here...')
                    .setMaxLength(4000)
                )
              );
            console.log(`[Hybrid Debug] JSON modal created, showing to user`);
            return interaction.showModal(modal);
          } catch (error) {
            console.error(`[Hybrid Debug] Error creating or showing JSON modal:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error creating JSON form. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "config_info") {
          const hybridMenuId = parts[2];
          try {
            return await showHybridInfoConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in config_info: ${error.message}`);
            throw error;
          }
        }

        if (action === "config_roles") {
          const hybridMenuId = parts[2];
          try {
            return await showHybridRolesConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in config_roles: ${error.message}`);
            throw error;
          }
        }

        if (action === "customize_embed") {
          const hybridMenuId = parts[2];
          try {
            return await showHybridEmbedCustomization(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in customize_embed: ${error.message}`);
            throw error;
          }
        }

        if (action === "publish") {
          const hybridMenuId = parts[2];
          try {
            return await publishHybridMenu(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in publish: ${error.message}`);
            throw error;
          }
        }

        if (action === "preview") {
          const hybridMenuId = parts[2];
          try {
            return previewHybridMenu(interaction, hybridMenuId);
          } catch (error) {
            console.error("Error in preview:", error);
            return sendEphemeralEmbed(interaction, "❌ Error loading preview.", "#FF0000", "Error", false);
          }
        }

        if (action === "back_to_config") {
          const hybridMenuId = parts[2];
          try {
            return showHybridMenuConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error("Error in back_to_config:", error);
            return sendEphemeralEmbed(interaction, "❌ Error navigating back to config.", "#FF0000", "Error", false);
          }
        }

        if (action === "back_to_info_config") {
          const hybridMenuId = parts[2];
          try {
            return showHybridInfoConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error("Error in back_to_info_config:", error);
            return sendEphemeralEmbed(interaction, "❌ Error navigating back to info config.", "#FF0000", "Error", false);
          }
        }

        if (action === "back_to_roles_config") {
          const hybridMenuId = parts[2];
          try {
            return await showHybridRolesConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in back_to_roles_config: ${error.message}`);
            throw error;
          }
        }

        if (action === "edit_role") {
          const hybridMenuId = parts[2];
          const roleType = parts[3];
          const roleId = parts[4];
          
          console.log(`[Hybrid Debug] Edit role button clicked for menu: ${hybridMenuId}, role: ${roleId}, type: ${roleType}`);
          
          // For now, show a placeholder message indicating this feature is coming soon
          return sendEphemeralEmbed(interaction, "🚧 Role editing features coming soon! This will allow you to customize role descriptions, emojis, and button colors.", "#FFA500", "Coming Soon", false);
        }

        if (action === "remove_role") {
          const hybridMenuId = parts[2];
          const roleType = parts[3];
          const roleId = parts[4];
          
          console.log(`[Hybrid Debug] Remove role button clicked for menu: ${hybridMenuId}, role: ${roleId}, type: ${roleType}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) {
              return sendEphemeralEmbed(interaction, "❌ Role not found.", "#FF0000", "Error", false);
            }

            // Remove the role from the appropriate array
            if (roleType === "dropdown") {
              const updatedDropdownRoles = (menu.dropdownRoles || []).filter(id => id !== roleId);
              await db.updateHybridMenu(hybridMenuId, { dropdownRoles: updatedDropdownRoles });
            } else if (roleType === "button") {
              const updatedButtonRoles = (menu.buttonRoles || []).filter(id => id !== roleId);
              await db.updateHybridMenu(hybridMenuId, { buttonRoles: updatedButtonRoles });
            }

            console.log(`[Hybrid Debug] Successfully removed ${roleType} role: ${roleId}`);
            await sendEphemeralEmbed(interaction, `✅ Role "${role.name}" removed from ${roleType} roles!`, "#00FF00", "Success", false);
            return showHybridRolesConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error removing role:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error removing role. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "component_order") {
          const hybridMenuId = parts[2];
          
          console.log(`[Hybrid Debug] Component order button clicked for menu: ${hybridMenuId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const embed = new EmbedBuilder()
              .setTitle(`📑 Component Order: ${menu.name}`)
              .setDescription("Configure the order in which components appear in your published hybrid menu.\n\n**Current Order:**")
              .setColor("#5865F2");

            // Get current component order or use defaults
            const currentOrder = menu.componentOrder || {
              infoDropdown: 1,
              roleDropdown: 2,
              infoButtons: 3,
              roleButtons: 4
            };

            // Create ordered list of components
            const orderEntries = Object.entries(currentOrder).sort((a, b) => a[1] - b[1]);
            const orderDisplay = orderEntries.map(([key, order], index) => {
              const componentNames = {
                infoDropdown: "📋 Info Pages Dropdown",
                roleDropdown: "🎭 Role Selection Dropdown", 
                infoButtons: "📋 Info Pages Buttons",
                roleButtons: "🎭 Role Selection Buttons"
              };
              return `${index + 1}. ${componentNames[key] || key}`;
            }).join('\n');

            embed.addFields([
              { name: "Current Component Order", value: orderDisplay, inline: false },
              { name: "How it works", value: "Components are arranged in the published menu according to this order. Lower numbers appear first.", inline: false }
            ]);

            const components = [];

            // Add reorder buttons
            const reorderRow1 = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`hybrid:move_component:${hybridMenuId}:infoDropdown:up`)
                .setLabel("📋↑ Info Dropdown Up")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentOrder.infoDropdown === 1),
              new ButtonBuilder()
                .setCustomId(`hybrid:move_component:${hybridMenuId}:infoDropdown:down`)
                .setLabel("📋↓ Info Dropdown Down")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentOrder.infoDropdown === 4),
              new ButtonBuilder()
                .setCustomId(`hybrid:move_component:${hybridMenuId}:roleDropdown:up`)
                .setLabel("🎭↑ Role Dropdown Up")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentOrder.roleDropdown === 1)
            );

            const reorderRow2 = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`hybrid:move_component:${hybridMenuId}:roleDropdown:down`)
                .setLabel("🎭↓ Role Dropdown Down")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentOrder.roleDropdown === 4),
              new ButtonBuilder()
                .setCustomId(`hybrid:reset_component_order:${hybridMenuId}`)
                .setLabel("🔄 Reset to Default")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`hybrid:back_to_config:${hybridMenuId}`)
                .setLabel("Back to Menu Config")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("⬅️")
            );

            components.push(reorderRow1, reorderRow2);

            const responseData = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
            
            if (interaction.deferred || interaction.replied) {
              await interaction.editReply(responseData);
            } else {
              await interaction.reply(responseData);
            }

            console.log(`[Hybrid Debug] Successfully showed component order configuration`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error showing component order:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error showing component order configuration. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "bulk_setup") {
          const hybridMenuId = parts[2];
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const embed = new EmbedBuilder()
              .setTitle("🚀 Quick Setup")
              .setDescription(`Choose a preset configuration for **${menu.name}**:\n\n` +
                "**Common Configurations:**\n" +
                "• **All Dropdown** - Everything shows as dropdown menus\n" +
                "• **All Buttons** - Everything shows as buttons\n" +
                "• **All Both** - Everything shows as both dropdown and buttons\n\n" +
                "**Mixed Configurations:**\n" +
                "• **Info: Dropdown, Roles: Buttons** - Info pages as dropdown, roles as buttons\n" +
                "• **Info: Buttons, Roles: Dropdown** - Info pages as buttons, roles as dropdown")
              .setColor("#00FF00");

            const components = [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`hybrid:bulk_all_dropdown:${hybridMenuId}`)
                  .setLabel("All Dropdown")
                  .setStyle(ButtonStyle.Primary)
                  .setEmoji("📋"),
                new ButtonBuilder()
                  .setCustomId(`hybrid:bulk_all_buttons:${hybridMenuId}`)
                  .setLabel("All Buttons")
                  .setStyle(ButtonStyle.Primary)
                  .setEmoji("🔘"),
                new ButtonBuilder()
                  .setCustomId(`hybrid:bulk_all_both:${hybridMenuId}`)
                  .setLabel("All Both")
                  .setStyle(ButtonStyle.Primary)
                  .setEmoji("🔗")
              ),
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`hybrid:bulk_info_dropdown_roles_button:${hybridMenuId}`)
                  .setLabel("Info: Dropdown, Roles: Buttons")
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji("📋"),
                new ButtonBuilder()
                  .setCustomId(`hybrid:bulk_info_button_roles_dropdown:${hybridMenuId}`)
                  .setLabel("Info: Buttons, Roles: Dropdown")
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji("🔘")
              ),
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`hybrid:back_to_display_types:${hybridMenuId}`)
                  .setLabel("← Back")
                  .setStyle(ButtonStyle.Secondary)
              )
            ];

            await interaction.editReply({
              embeds: [embed],
              components,
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error("Error showing bulk setup:", error);
            return sendEphemeralEmbed(interaction, "❌ Error showing bulk setup. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "add_info_page") {
          const hybridMenuId = parts[2];
          try {
            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(`hybrid:select_page_display_type:${hybridMenuId}`)
              .setPlaceholder("Choose how this page should be displayed...")
              .addOptions([
                { label: "Dropdown", value: "dropdown", description: "Show as dropdown option", emoji: "📋" },
                { label: "Button", value: "button", description: "Show as individual button", emoji: "🔘" }
              ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            await interaction.editReply({
              content: "📋 **Add Information Page**\n\nFirst, choose how you want this page to be displayed:",
              components: [row],
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error("Error showing page display type selection:", error);
            return sendEphemeralEmbed(interaction, "❌ Error showing selection menu. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "add_info_page_json") {
          const hybridMenuId = parts[2];
          const modal = new ModalBuilder()
            .setCustomId(`hybrid:modal:add_info_page_json:${hybridMenuId}`)
            .setTitle("Add Page from JSON")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("json_data")
                  .setLabel("Raw JSON Data")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder('Paste your JSON from Discohook here...')
                  .setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "add_dropdown_role") {
          const hybridMenuId = parts[2];
          console.log(`[Hybrid Debug] Processing add_dropdown_role for menu: ${hybridMenuId}`);
          
          try {
            const allRoles = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);
            
            if (allRoles.size === 0) {
              console.log(`[Hybrid Debug] No roles available to add`);
              return sendEphemeralEmbed(interaction, "❌ No roles available to add.", "#FF0000", "Error", false);
            }

            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Hybrid Debug] Hybrid menu not found: ${hybridMenuId}`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const currentRoles = menu.dropdownRoles || [];
            const availableRoles = allRoles.filter(r => !currentRoles.includes(r.id));

            console.log(`[Hybrid Debug] Available roles count: ${availableRoles.size}`);

            if (availableRoles.size === 0) {
              console.log(`[Hybrid Debug] All roles already added to dropdown`);
              return sendEphemeralEmbed(interaction, "❌ All roles are already added to the dropdown.", "#FF0000", "Error", false);
            }

            const roleOptions = Array.from(availableRoles.values()).slice(0, 25).map(r => ({
              label: r.name,
              value: r.id,
              description: `Role ID: ${r.id}`
            }));

            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(`hybrid:select_dropdown_role:${hybridMenuId}`)
              .setPlaceholder("Select roles to add to dropdown...")
              .setMinValues(1)
              .setMaxValues(Math.min(roleOptions.length, 25))
              .addOptions(roleOptions);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            console.log(`[Hybrid Debug] About to edit reply with role selection menu`);
            
            // Use editReply for deferred interactions, reply for non-deferred
            const replyMethod = interaction.deferred ? 'editReply' : 'reply';
            const replyOptions = {
              content: "Select roles to add to the dropdown:",
              components: [row],
              flags: MessageFlags.Ephemeral
            };

            await interaction[replyMethod](replyOptions);
            console.log(`[Hybrid Debug] Successfully sent role selection menu using ${replyMethod}`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in add_dropdown_role:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error showing role selection. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "add_button_role") {
          const hybridMenuId = parts[2];
          console.log(`[Hybrid Debug] Processing add_button_role for menu: ${hybridMenuId}`);
          
          try {
            const allRoles = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id);
            
            if (allRoles.size === 0) {
              console.log(`[Hybrid Debug] No roles available to add as buttons`);
              return sendEphemeralEmbed(interaction, "❌ No roles available to add.", "#FF0000", "Error", false);
            }

            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Hybrid Debug] Hybrid menu not found: ${hybridMenuId}`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const currentRoles = menu.buttonRoles || [];
            const availableRoles = allRoles.filter(r => !currentRoles.includes(r.id));

            console.log(`[Hybrid Debug] Available button roles count: ${availableRoles.size}`);

            if (availableRoles.size === 0) {
              console.log(`[Hybrid Debug] All roles already added as buttons`);
              return sendEphemeralEmbed(interaction, "❌ All roles are already added as buttons.", "#FF0000", "Error", false);
            }

            const roleOptions = Array.from(availableRoles.values()).slice(0, 25).map(r => ({
              label: r.name,
              value: r.id,
              description: `Role ID: ${r.id}`
            }));

            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(`hybrid:select_button_role:${hybridMenuId}`)
              .setPlaceholder("Select roles to add as buttons...")
              .setMinValues(1)
              .setMaxValues(Math.min(roleOptions.length, 25))
              .addOptions(roleOptions);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            console.log(`[Hybrid Debug] About to edit reply with button role selection menu`);
            
            // Use editReply for deferred interactions, reply for non-deferred
            const replyMethod = interaction.deferred ? 'editReply' : 'reply';
            const replyOptions = {
              content: "Select roles to add as buttons:",
              components: [row],
              flags: MessageFlags.Ephemeral
            };

            await interaction[replyMethod](replyOptions);
            console.log(`[Hybrid Debug] Successfully sent button role selection menu using ${replyMethod}`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in add_button_role:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error showing role selection. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "edit_info_page") {
          const hybridMenuId = parts[2];
          const pageId = parts[3];
          
          const menu = db.getHybridMenu(hybridMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
          }

          const page = menu.pages?.find(p => p.id === pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          const modal = new ModalBuilder()
            .setCustomId(`hybrid:modal:edit_info_page:${hybridMenuId}:${pageId}`)
            .setTitle("Edit Information Page")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_name")
                  .setLabel("Page Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setValue(page.name || page.title || "")
                  .setMaxLength(80)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_content")
                  .setLabel("Page Content")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setValue(page.content || page.description || "")
                  .setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "delete_info_page") {
          const hybridMenuId = parts[2];
          const pageId = parts[3];
          
          const menu = db.getHybridMenu(hybridMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
          }

          const page = menu.pages?.find(p => p.id === pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          // Remove the page from the menu
          const updatedPages = menu.pages.filter(p => p.id !== pageId);
          await db.updateHybridMenu(hybridMenuId, { pages: updatedPages });

          await sendEphemeralEmbed(interaction, `✅ Page "${page.name || page.title || 'Untitled Page'}" deleted successfully!`, "#00FF00", "Success", false);
          return showHybridInfoConfiguration(interaction, hybridMenuId);
        }

        if (action === "change_page_display_type") {
          const hybridMenuId = parts[2];
          const pageId = parts[3];
          
          const menu = db.getHybridMenu(hybridMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
          }

          const page = menu.pages?.find(p => p.id === pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          const currentDisplayType = page.displayType || 'dropdown';
          const newDisplayType = currentDisplayType === 'dropdown' ? 'button' : 'dropdown';
          
          // Update the page display type
          const updatedPages = menu.pages.map(p => 
            p.id === pageId ? { ...p, displayType: newDisplayType } : p
          );
          
          await db.updateHybridMenu(hybridMenuId, { pages: updatedPages });
          
          await sendEphemeralEmbed(interaction, `✅ Page display type changed from **${currentDisplayType}** to **${newDisplayType}**!`, "#00FF00", "Success", false);
          return showHybridInfoConfiguration(interaction, hybridMenuId);
        }

        if (action === "change_page_button_color") {
          const hybridMenuId = parts[2];
          const pageId = parts[3];
          
          const menu = db.getHybridMenu(hybridMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
          }

          const page = menu.pages?.find(p => p.id === pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`hybrid:set_page_button_color:${hybridMenuId}:${pageId}`)
            .setPlaceholder("Choose button color...")
            .addOptions([
              { label: "Primary (Blue)", value: "Primary", emoji: "🔵" },
              { label: "Secondary (Gray)", value: "Secondary", emoji: "⚪" },
              { label: "Success (Green)", value: "Success", emoji: "🟢" },
              { label: "Danger (Red)", value: "Danger", emoji: "🔴" }
            ]);

          const row = new ActionRowBuilder().addComponents(selectMenu);
          
          await interaction.editReply({
            content: `🎨 **Change Button Color for "${page.name || page.title || 'Untitled Page'}"**\n\nCurrent color: **${page.buttonColor || 'Primary'}**`,
            components: [row],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "remove_role") {
          const hybridMenuId = parts[2];
          const roleType = parts[3]; // "dropdown" or "button"
          const roleId = parts[4];
          
          const menu = db.getHybridMenu(hybridMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
          }

          const role = interaction.guild.roles.cache.get(roleId);
          const roleName = role ? role.name : "Unknown Role";

          // Remove the role from the appropriate array
          if (roleType === "dropdown" && menu.dropdownRoles) {
            const updatedDropdownRoles = menu.dropdownRoles.filter(id => id !== roleId);
            await db.updateHybridMenu(hybridMenuId, { dropdownRoles: updatedDropdownRoles });
          } else if (roleType === "button" && menu.buttonRoles) {
            const updatedButtonRoles = menu.buttonRoles.filter(id => id !== roleId);
            await db.updateHybridMenu(hybridMenuId, { buttonRoles: updatedButtonRoles });
          }

          await sendEphemeralEmbed(interaction, `✅ Role "${roleName}" removed from ${roleType} successfully!`, "#00FF00", "Success", false);
          return showHybridRolesConfiguration(interaction, hybridMenuId);
        }

        if (action === "move_component") {
          const hybridMenuId = parts[2];
          const componentType = parts[3]; // "infoDropdown", "roleDropdown", etc.
          const direction = parts[4]; // "up" or "down"
          
          console.log(`[Hybrid Debug] Moving component ${componentType} ${direction} for menu: ${hybridMenuId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            // Get current component order or use defaults
            const currentOrder = menu.componentOrder || {
              infoDropdown: 1,
              roleDropdown: 2,
              infoButtons: 3,
              roleButtons: 4
            };

            const currentPosition = currentOrder[componentType];
            let newPosition;

            if (direction === "up") {
              newPosition = Math.max(1, currentPosition - 1);
            } else {
              newPosition = Math.min(4, currentPosition + 1);
            }

            if (newPosition === currentPosition) {
              console.log(`[Hybrid Debug] Component ${componentType} already at ${direction === "up" ? "top" : "bottom"}`);
              return sendEphemeralEmbed(interaction, `❌ Component is already at the ${direction === "up" ? "top" : "bottom"}.`, "#FF0000", "Error", false);
            }

            // Find the component at the target position and swap
            const targetComponent = Object.keys(currentOrder).find(key => currentOrder[key] === newPosition);
            if (targetComponent) {
              currentOrder[targetComponent] = currentPosition;
            }
            currentOrder[componentType] = newPosition;

            // Update the menu in the database
            await db.updateHybridMenu(hybridMenuId, { componentOrder: currentOrder });

            console.log(`[Hybrid Debug] Component order updated successfully`);

            // Show updated component order UI immediately
            return showComponentOrderConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error moving component:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error moving component. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "reset_component_order") {
          const hybridMenuId = parts[2];
          
          console.log(`[Hybrid Debug] Resetting component order for menu: ${hybridMenuId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            // Reset to default order
            const defaultOrder = {
              infoDropdown: 1,
              roleDropdown: 2,
              infoButtons: 3,
              roleButtons: 4
            };

            // Update the menu in the database
            await db.updateHybridMenu(hybridMenuId, { componentOrder: defaultOrder });

            console.log(`[Hybrid Debug] Component order reset to defaults successfully`);

            // Show updated component order UI immediately
            return showComponentOrderConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error resetting component order:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error resetting component order. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "customize_dropdown_text") {
          const hybridMenuId = parts[2];
          
          console.log(`[Hybrid Debug] Showing dropdown text customization for menu: ${hybridMenuId}`);
          
          const menu = db.getHybridMenu(hybridMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
          }

          // Check if interaction was deferred/replied - modal can't be shown
          if (interaction.deferred || interaction.replied) {
            return interaction.editReply({ 
              content: "❌ Cannot show dropdown text customization at this time. Please try clicking the Customize Dropdown Text button again.",
              flags: MessageFlags.Ephemeral 
            });
          }

          const modal = new ModalBuilder()
            .setCustomId(`hybrid:modal:customize_dropdown_text:${hybridMenuId}`)
            .setTitle("Customize Dropdown Text")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("info_dropdown_placeholder")
                  .setLabel("Info Pages Dropdown Placeholder")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(menu.infoDropdownPlaceholder || "📚 Select a page to view...")
                  .setMaxLength(150)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("role_dropdown_placeholder")
                  .setLabel("Role Dropdown Placeholder")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(menu.roleDropdownPlaceholder || "🎭 Select roles to toggle...")
                  .setMaxLength(150)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("info_dropdown_max_text")
                  .setLabel("Info Dropdown Max Selection Text")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(menu.infoDropdownMaxText || "You can only select one page at a time")
                  .setMaxLength(150)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("role_dropdown_max_text")
                  .setLabel("Role Dropdown Max Selection Text")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setValue(menu.roleDropdownMaxText || "Select multiple roles")
                  .setMaxLength(150)
              )
            );
          
          return interaction.showModal(modal);
        }

        if (action === "webhook_branding") {
          const hybridMenuId = parts[2];
          
          const menu = db.getHybridMenu(hybridMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
          }

          // Use the working pattern from reaction role system
          const modal = new ModalBuilder()
            .setCustomId(`hybrid:modal:webhook_branding:${hybridMenuId}`)
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

        if (action === "toggle_webhook") {
          const hybridMenuId = parts[2];
          
          console.log(`[Hybrid Debug] Toggling webhook for menu: ${hybridMenuId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const newWebhookState = !menu.useWebhook;
            await db.updateHybridMenu(hybridMenuId, { useWebhook: newWebhookState });

            const statusMessage = newWebhookState ? "✅ Webhook enabled successfully!" : "✅ Webhook disabled successfully!";
            await sendEphemeralEmbed(interaction, statusMessage, "#00FF00", "Success", false);
            return showHybridMenuConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error toggling webhook:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error toggling webhook. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "toggle_member_counts") {
          const hybridMenuId = parts[2];
          
          console.log(`[Hybrid Debug] Configuring member counts for menu: ${hybridMenuId}`);
          
          const menu = db.getHybridMenu(hybridMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
          }

          const modal = new ModalBuilder()
            .setCustomId(`hybrid:modal:configure_member_counts:${hybridMenuId}`)
            .setTitle("Configure Member Count Display");

          const currentOptions = menu.memberCountOptions || { showInDropdowns: false, showInButtons: false };
          const legacyEnabled = menu.showMemberCounts;

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("show_in_dropdowns")
                .setLabel("Show in Dropdown Options")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("true or false")
                .setValue(String(currentOptions.showInDropdowns || legacyEnabled))
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("show_in_buttons")
                .setLabel("Show in Role Buttons")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("true or false")
                .setValue(String(currentOptions.showInButtons || legacyEnabled))
            )
          );

          return interaction.showModal(modal);
        }

        if (action === "back_to_config") {
          const hybridMenuId = parts[2];
          
          console.log(`[Hybrid Debug] Returning to main config for menu: ${hybridMenuId}`);
          
          return showHybridMenuConfiguration(interaction, hybridMenuId);
        }
        } catch (error) {
          console.error(`[Hybrid Debug] Unexpected error in hybrid menu handler:`, error);
          console.error(`[Hybrid Debug] Action: ${action}, CustomId: ${interaction.customId}`);
          // Try to send an error message if the interaction hasn't been handled yet
          try {
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({ content: "❌ An unexpected error occurred. Please try again.", flags: MessageFlags.Ephemeral });
            } else if (interaction.deferred) {
              await interaction.editReply({ content: "❌ An unexpected error occurred. Please try again." });
            }
          } catch (replyError) {
            console.error(`[Hybrid Debug] Error sending error message:`, replyError);
          }
          return;
        }
      }

      if (ctx === "dynamic") {
        if (action === "test") {
          const testEmbed = new EmbedBuilder()
            .setTitle("🧪 Dynamic Content Test")
            .setDescription("Here's how dynamic variables work in real-time!")
            .setColor("#9932cc")
            .addFields([
              { name: "User Info", value: `Hello ${processDynamicContent('{user}', interaction)}!\nYour name is: ${processDynamicContent('{user.name}', interaction)}\nYour ID: ${processDynamicContent('{user.id}', interaction)}`, inline: false },
              { name: "Server Info", value: `Server: ${processDynamicContent('{server}', interaction)}\nMembers: ${processDynamicContent('{server.members}', interaction)}`, inline: false },
              { name: "Time Info", value: `Current time: ${processDynamicContent('{time}', interaction)}\nShort time: ${processDynamicContent('{time.short}', interaction)}\nRelative: ${processDynamicContent('{timestamp}', interaction)}`, inline: false },
              { name: "Bot Info", value: `Bot: ${processDynamicContent('{bot.name}', interaction)}\nPing: ${processDynamicContent('{bot.ping}', interaction)}\nUptime: ${processDynamicContent('{bot.uptime}', interaction)}`, inline: false },
              { name: "Random", value: `Random number: ${processDynamicContent('{random.number}', interaction)}\nRandom color: ${processDynamicContent('{random.color}', interaction)}`, inline: false }
            ]);
          
          const backButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("dash:dynamic-content")
              .setLabel("Back to Dynamic Content")
              .setStyle(ButtonStyle.Secondary)
          );
          
          await interaction.editReply({ embeds: [testEmbed], components: [backButton], flags: MessageFlags.Ephemeral });
          return;
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
          if (!menuId) return interaction.reply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.reply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:configure_member_counts:${menuId}`)
            .setTitle("Configure Member Count Display");

          const currentOptions = menu.memberCountOptions || { showInDropdowns: false, showInButtons: false };
          const legacyEnabled = menu.showMemberCounts;

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("show_in_dropdowns")
                .setLabel("Show in Dropdown Options")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("true or false")
                .setValue(String(currentOptions.showInDropdowns || legacyEnabled))
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("show_in_buttons")
                .setLabel("Show in Role Buttons")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("true or false")
                .setValue(String(currentOptions.showInButtons || legacyEnabled))
            )
          );

          return interaction.showModal(modal);
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

        if (action === "simple_button_colors") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const buttonRoles = menu.buttonRoles || [];
          if (buttonRoles.length === 0) {
            return interaction.editReply({ content: "No button roles configured for this menu.", flags: MessageFlags.Ephemeral });
          }

          // Create role options
          const roleOptions = buttonRoles.slice(0, 25).map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return null;
            
            const currentColor = menu.buttonColors?.[roleId] || 'Primary';
            return {
              label: role.name.substring(0, 100),
              value: roleId,
              description: `Current: ${currentColor}`,
              emoji: '🎨'
            };
          }).filter(Boolean);

          if (roleOptions.length === 0) {
            return interaction.editReply({ content: "No valid button roles found.", flags: MessageFlags.Ephemeral });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_role_for_color:${menuId}`)
            .setPlaceholder("Select a role to change its button color...")
            .addOptions(roleOptions);

          const row = new ActionRowBuilder().addComponents(selectMenu);
          
          await interaction.editReply({
            content: "🎨 **Simple Button Colors**\n\nSelect a role to change its button color:",
            components: [row],
            flags: MessageFlags.Ephemeral
          });
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

      if (ctx === "info") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure information menus.", "#FF0000", "Permission Denied", false);
        }

        if (action === "create") {
          const modal = new ModalBuilder()
            .setCustomId("info:modal:create")
            .setTitle("Create Information Menu")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("name")
                  .setLabel("Menu Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Rules, FAQ, Guide, etc.")
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("desc")
                  .setLabel("Menu Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder("Brief description of what this menu contains")
                  .setMaxLength(1000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "browse_templates") {
          const templates = db.getInfoMenus().filter(menu => menu.isTemplate);
          if (templates.length === 0) {
            return sendEphemeralEmbed(interaction, "❌ No information menu templates found.", "#FF0000", "No Templates", false);
          }

          const templateOptions = templates.slice(0, 25).map((template) => ({
            label: template.templateName?.substring(0, 100) || template.name.substring(0, 100),
            value: template.id,
            description: template.templateDescription?.substring(0, 100) || template.desc?.substring(0, 100) || undefined
          }));

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("info:select_template")
            .setPlaceholder("Select a template to use...")
            .addOptions(templateOptions);

          return interaction.editReply({
            content: "Select a template to create a new information menu:",
            components: [new ActionRowBuilder().addComponents(selectMenu)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "create_from_json") {
          const modal = new ModalBuilder()
            .setCustomId("info:modal:create_from_json")
            .setTitle("Create Info Menu from JSON")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("raw_json_input")
                  .setLabel("JSON Configuration")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder('{"name": "Server Rules", "desc": "All server rules", "embedColor": "#5865F2"}')
                  .setMaxLength(4000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "toggle_type") {
          const componentType = parts[2]; // 'dropdown' or 'button'
          const infoMenuId = parts[3]; // The menu ID
          
          if (!infoMenuId) {
            return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          }

          const menu = db.getInfoMenu(infoMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
          }
          
          // Initialize selectionTypes as an array if it's not already
          let selectionTypes = Array.isArray(menu.selectionType) ? menu.selectionType : 
                              (menu.selectionType ? [menu.selectionType] : []);
          
          if (selectionTypes.includes(componentType)) {
            // Remove the type if it's currently enabled
            selectionTypes = selectionTypes.filter(type => type !== componentType);
            await db.updateInfoMenu(infoMenuId, { selectionType: selectionTypes });
            await sendEphemeralEmbed(interaction, `✅ ${componentType.charAt(0).toUpperCase() + componentType.slice(1)} display disabled!`, "#00FF00", "Success", false);
          } else {
            // Add the type if it's currently disabled
            selectionTypes.push(componentType);
            await db.updateInfoMenu(infoMenuId, { selectionType: selectionTypes });
            await sendEphemeralEmbed(interaction, `✅ ${componentType.charAt(0).toUpperCase() + componentType.slice(1)} display enabled!`, "#00FF00", "Success", false);
          }
          
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        // Actions that require menuId
        const infoMenuId = parts[2];
        if (!infoMenuId) {
          return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
        }

        const menu = db.getInfoMenu(infoMenuId);
        if (!menu) {
          return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
        }

        if (action === "add_page") {
          // Show page creation options with templates
          return showPageCreationOptions(interaction, infoMenuId);
        }

        if (action === "add_page_custom") {
          const modal = new ModalBuilder()
            .setCustomId(`info:modal:add_page_custom:${infoMenuId}`)
            .setTitle("Create Custom Page")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_name")
                  .setLabel("Page Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Rules, FAQ, Guide, etc.")
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_title")
                  .setLabel("Page Title (Embed Title)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Server Rules")
                  .setMaxLength(256)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_description")
                  .setLabel("Page Content (Description)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder("Enter the main content for this page...")
                  .setMaxLength(4000)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_color")
                  .setLabel("Page Color (Hex Code)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("#5865F2")
                  .setMaxLength(7)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_emoji")
                  .setLabel("Page Icon (Emoji)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("📋")
                  .setMaxLength(10)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "add_page_template") {
          const templateType = parts[3];
          return createPageFromTemplate(interaction, infoMenuId, templateType);
        }

        if (action === "customize_embed") {
          const modal = new ModalBuilder()
            .setCustomId(`info:modal:customize_embed:${infoMenuId}`)
            .setTitle("Customize Embed Appearance")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("embed_color")
                  .setLabel("Embed Color (hex)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("#5865F2")
                  .setValue(menu.embedColor || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("thumbnail_url")
                  .setLabel("Thumbnail URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/image.png")
                  .setValue(menu.embedThumbnail || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("image_url")
                  .setLabel("Image URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/image.png")
                  .setValue(menu.embedImage || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("author_name")
                  .setLabel("Author Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("Server Name or Author")
                  .setValue(menu.embedAuthorName || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("author_icon_url")
                  .setLabel("Author Icon URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/icon.png")
                  .setValue(menu.embedAuthorIconURL || "")
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "customize_footer") {
          const modal = new ModalBuilder()
            .setCustomId(`info:modal:customize_footer:${infoMenuId}`)
            .setTitle("Customize Footer")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("footer_text")
                  .setLabel("Footer Text")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("Server Name • Contact Info")
                  .setValue(menu.embedFooterText || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("footer_icon_url")
                  .setLabel("Footer Icon URL")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://example.com/icon.png")
                  .setValue(menu.embedFooterIconURL || "")
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "toggle_webhook") {
          const newWebhookState = !menu.useWebhook;
          await db.updateInfoMenu(infoMenuId, { useWebhook: newWebhookState });
          await sendEphemeralEmbed(interaction, `✅ Webhook ${newWebhookState ? 'enabled' : 'disabled'}!`, "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (action === "publish") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          return publishInfoMenu(interaction, infoMenuId);
        }

        if (action === "edit_published") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const menu = db.getInfoMenu(infoMenuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return sendEphemeralEmbed(interaction, "❌ No published message found for this menu to edit.", "#FF0000", "Error", false);
          }
          
          const channel = interaction.guild.channels.cache.get(menu.channelId);
          if (!channel) return sendEphemeralEmbed(interaction, "❌ Published channel not found.", "#FF0000", "Error", false);

          try {
            const message = await channel.messages.fetch(menu.messageId);
            return publishInfoMenu(interaction, infoMenuId, message);
          } catch (error) {
            console.error("Error fetching published info menu message:", error);
            return sendEphemeralEmbed(interaction, "❌ Failed to fetch published message. It might have been deleted manually.", "#FF0000", "Error", false);
          }
        }

        if (action === "delete_published") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const menu = db.getInfoMenu(infoMenuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return sendEphemeralEmbed(interaction, "❌ No published message found for this menu to delete.", "#FF0000", "Error", false);
          }

          const confirmButton = new ButtonBuilder()
            .setCustomId(`info:confirm_delete_published:${infoMenuId}`)
            .setLabel("Confirm Delete Published Message")
            .setStyle(ButtonStyle.Danger);
          const cancelButton = new ButtonBuilder()
            .setCustomId(`info:cancel_delete_published:${infoMenuId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary);
          const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

          return interaction.editReply({
            content: "⚠️ Are you sure you want to delete the published information menu message? This cannot be undone.",
            components: [row],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "confirm_delete_published") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const menu = db.getInfoMenu(infoMenuId);
          if (!menu || !menu.channelId || !menu.messageId) {
            return sendEphemeralEmbed(interaction, "❌ No published message found or already deleted.", "#FF0000", "Error", false);
          }
          
          const channel = interaction.guild.channels.cache.get(menu.channelId);
          if (!channel) {
            await db.updateInfoMenu(infoMenuId, { channelId: null, messageId: null });
            return sendEphemeralEmbed(interaction, "❌ Published channel not found. Message ID cleared.", "#FF0000", "Error", false);
          }

          try {
            const message = await channel.messages.fetch(menu.messageId);
            await message.delete();
            await db.updateInfoMenu(infoMenuId, { channelId: null, messageId: null });
            await sendEphemeralEmbed(interaction, "✅ Published message deleted successfully!", "#00FF00", "Success", false);
            return showInfoMenuConfiguration(interaction, infoMenuId);
          } catch (error) {
            console.error("Error deleting info menu message:", error);
            await db.updateInfoMenu(infoMenuId, { channelId: null, messageId: null });
            return sendEphemeralEmbed(interaction, "❌ Failed to delete message. It might have already been deleted manually. Message ID cleared.", "#FF0000", "Error", false);
          }
        }

        if (action === "cancel_delete_published") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          return sendEphemeralEmbed(interaction, "Deletion cancelled.", "#00FF00", "Cancelled", false);
        }

        if (action === "delete_menu") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const confirmButton = new ButtonBuilder()
            .setCustomId(`info:confirm_delete_menu:${infoMenuId}`)
            .setLabel("Confirm Delete Menu")
            .setStyle(ButtonStyle.Danger);
          const cancelButton = new ButtonBuilder()
            .setCustomId(`info:cancel_delete_menu:${infoMenuId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary);
          const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

          return interaction.editReply({
            content: "⚠️ Are you sure you want to delete this entire information menu? This will remove all its configurations and cannot be undone.",
            components: [row],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "confirm_delete_menu") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const menu = db.getInfoMenu(infoMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Menu not found or already deleted.", "#FF0000", "Error", false);
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
                console.log("Couldn't delete associated published info menu message, probably already deleted or not found.");
              }
            }
            
            await db.deleteInfoMenu(infoMenuId);
            await sendEphemeralEmbed(interaction, "✅ Information menu and its associated published message (if any) deleted successfully!", "#00FF00", "Success", false);
            return showInfoMenusDashboard(interaction);
          } catch (error) {
            console.error("Error deleting info menu:", error);
            return sendEphemeralEmbed(interaction, `❌ Failed to delete menu: ${error.message}`, "#FF0000", "Error", false);
          }
        }

        if (action === "cancel_delete_menu") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          return sendEphemeralEmbed(interaction, "Deletion cancelled.", "#00FF00", "Cancelled", false);
        }

        if (action === "save_as_template") {
          const modal = new ModalBuilder()
            .setCustomId(`info:modal:save_as_template:${infoMenuId}`)
            .setTitle("Save as Template")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("template_name")
                  .setLabel("Template Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Server Rules Template, FAQ Template, etc.")
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("template_description")
                  .setLabel("Template Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("What this template is for and how to use it")
                  .setMaxLength(500)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "manage_pages") {
          return showInfoMenuPageManagement(interaction, infoMenuId);
        }

        if (action === "configure_display") {
          return showPageDisplayConfiguration(interaction, infoMenuId);
        }

        if (action === "cycle_display") {
          const pageId = parts[3];
          
          if (!pageId) {
            return sendEphemeralEmbed(interaction, "❌ Page ID missing.", "#FF0000", "Error", false);
          }

          const page = db.getInfoMenuPage(infoMenuId, pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          // Cycle through display options: Both → Dropdown Only → Button Only → Hidden → Both
          const currentDisplay = page.displayIn || ['dropdown', 'button'];
          let newDisplay;
          let statusMessage;

          if (Array.isArray(currentDisplay)) {
            if (currentDisplay.includes('dropdown') && currentDisplay.includes('button')) {
              // Currently Both → change to Dropdown Only
              newDisplay = ['dropdown'];
              statusMessage = "📋 Dropdown Only";
            } else if (currentDisplay.includes('dropdown') && !currentDisplay.includes('button')) {
              // Currently Dropdown Only → change to Button Only
              newDisplay = ['button'];
              statusMessage = "🔘 Button Only";
            } else if (currentDisplay.includes('button') && !currentDisplay.includes('dropdown')) {
              // Currently Button Only → change to Hidden
              newDisplay = [];
              statusMessage = "❌ Hidden";
            } else {
              // Currently Hidden → change to Both
              newDisplay = ['dropdown', 'button'];
              statusMessage = "📋🔘 Both";
            }
          } else {
            // Fallback: set to Both
            newDisplay = ['dropdown', 'button'];
            statusMessage = "📋🔘 Both";
          }

          // Update the page
          const updatedPage = { ...page, displayIn: newDisplay };
          await db.saveInfoMenuPage(infoMenuId, updatedPage);

          await sendEphemeralEmbed(interaction, `✅ "${page.name}" set to: ${statusMessage}`, "#00FF00", "Success", false);
          
          // Return to the display configuration screen
          return showPageDisplayConfiguration(interaction, infoMenuId);
        }

        if (action === "back_to_config") {
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (action === "confirm_delete_page") {
          const pageId = parts[3];
          if (!pageId) {
            return sendEphemeralEmbed(interaction, "❌ Page ID missing.", "#FF0000", "Error", false);
          }

          const page = db.getInfoMenuPage(infoMenuId, pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found or already deleted.", "#FF0000", "Error", false);
          }

          try {
            await db.removeInfoMenuPage(infoMenuId, pageId);
            await sendEphemeralEmbed(interaction, `✅ Page "${page.name}" deleted successfully!`, "#00FF00", "Success", false);
            return showInfoMenuPageManagement(interaction, infoMenuId);
          } catch (error) {
            console.error("Error deleting info menu page:", error);
            return sendEphemeralEmbed(interaction, `❌ Failed to delete page: ${error.message}`, "#FF0000", "Error", false);
          }
        }

        if (action === "cancel_delete_page") {
          return showInfoMenuPageManagement(interaction, infoMenuId);
        }

        if (action === "reorder_pages") {
          const menu = db.getInfoMenu(infoMenuId);
          if (!menu) {
            return interaction.editReply({
              content: "❌ Information menu not found.",
              flags: MessageFlags.Ephemeral
            });
          }

          const pages = db.getInfoMenuPages(infoMenuId);
          if (!pages || pages.length < 2) {
            return interaction.editReply({
              content: "❌ You need at least 2 pages to reorder them.",
              flags: MessageFlags.Ephemeral
            });
          }

          // Create a user-friendly display of current pages with numbers
          const pageDisplay = pages.map((page, index) => {
            return `${index + 1}. ${page.name}`;
          }).join('\n');

          // Create example showing how to reorder
          const exampleOrder = pages.length >= 3 
            ? `Example: "3, 1, 2" would move the 3rd page to first position`
            : `Example: "2, 1" would reverse the order`;

          const modal = new ModalBuilder()
            .setCustomId(`info:modal:reorder_pages:${infoMenuId}`)
            .setTitle("Reorder Pages")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("current_pages_display")
                  .setLabel("Current Page Order (for reference)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setValue(pageDisplay)
                  .setMaxLength(2000)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("new_order_numbers")
                  .setLabel("New Order (comma-separated numbers)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("1, 2, 3, 4...")
                  .setValue("1, 2, 3, 4, 5".substring(0, pages.length * 3 - 1)) // Default current order
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

        if (action === "configure_button_colors") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const pages = db.getInfoMenuPages(infoMenuId);
          if (!pages || pages.length === 0) {
            return sendEphemeralEmbed(interaction, "❌ No pages found to configure colors for.", "#FF0000", "Error", false);
          }

          // Filter pages that can appear as buttons
          const buttonPages = pages.filter(page => {
            const displayIn = page.displayIn || ['dropdown', 'button'];
            return Array.isArray(displayIn) ? displayIn.includes('button') : displayIn === 'button';
          });

          if (buttonPages.length === 0) {
            return sendEphemeralEmbed(interaction, "❌ No pages are configured to show as buttons.", "#FF0000", "Error", false);
          }

          // Create select menu for choosing which page to configure
          const pageOptions = buttonPages.slice(0, 25).map(page => ({
            label: page.name.substring(0, 100),
            value: page.id,
            description: page.buttonColor ? `Current: ${page.buttonColor}` : "Current: Primary (default)",
            emoji: page.emoji || "📄"
          }));

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`info:select_page_for_button_color:${infoMenuId}`)
            .setPlaceholder("Select a page to configure button color...")
            .addOptions(pageOptions);

          return interaction.editReply({
            content: "Select a page to configure its button color:",
            components: [new ActionRowBuilder().addComponents(selectMenu)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "page_descriptions") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const pages = db.getInfoMenuPages(infoMenuId);
          if (!pages || pages.length === 0) {
            return sendEphemeralEmbed(interaction, "❌ No pages found to set descriptions for.", "#FF0000", "Error", false);
          }

          // Filter pages that can appear in dropdown
          const dropdownPages = pages.filter(page => {
            const displayIn = page.displayIn || ['dropdown', 'button'];
            return Array.isArray(displayIn) ? displayIn.includes('dropdown') : displayIn === 'dropdown';
          });

          if (dropdownPages.length === 0) {
            return sendEphemeralEmbed(interaction, "❌ No pages are configured to show in dropdown.", "#FF0000", "Error", false);
          }

          // Create select menu for choosing which page to set description
          const pageOptions = dropdownPages.slice(0, 25).map(page => ({
            label: page.name.substring(0, 100),
            value: page.id,
            description: page.dropdownDescription ? page.dropdownDescription.substring(0, 100) : "No description set",
            emoji: page.emoji || "📄"
          }));

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`info:select_page_for_description:${infoMenuId}`)
            .setPlaceholder("Select a page to set its description...")
            .addOptions(pageOptions);

          return interaction.editReply({
            content: "Select a page to set its dropdown description:",
            components: [new ActionRowBuilder().addComponents(selectMenu)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "configure_page_emojis") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const pages = db.getInfoMenuPages(infoMenuId);
          if (!pages || pages.length === 0) {
            return sendEphemeralEmbed(interaction, "❌ No pages found to configure emojis for.", "#FF0000", "Error", false);
          }

          // Create select menu for choosing which page to configure
          const pageOptions = pages.slice(0, 25).map(page => ({
            label: page.name.substring(0, 100),
            value: page.id,
            description: page.emoji ? `Current: ${page.emoji}` : "No emoji set",
            emoji: page.emoji || "📄"
          }));

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`info:select_page_for_emoji:${infoMenuId}`)
            .setPlaceholder("Select a page to configure its emoji...")
            .addOptions(pageOptions);

          return interaction.editReply({
            content: "Select a page to configure its emoji:",
            components: [new ActionRowBuilder().addComponents(selectMenu)],
            flags: MessageFlags.Ephemeral
          });
        }

        if (action === "customize_dropdown_text") {
          if (!infoMenuId) return sendEphemeralEmbed(interaction, "❌ Menu ID missing.", "#FF0000", "Error", false);
          
          const menu = db.getInfoMenu(infoMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
          }

          // Create modal for dropdown text customization
          const modal = new ModalBuilder()
            .setCustomId(`info:modal:customize_dropdown_text:${infoMenuId}`)
            .setTitle("Customize Dropdown Text")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("dropdown_placeholder")
                  .setLabel("Dropdown Placeholder Text")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("📚 Select a page to view...")
                  .setValue(menu.dropdownPlaceholder || "📚 Select a page to view...")
                  .setMaxLength(150)
              )
            );
          
          return interaction.showModal(modal);
        }

        // Add more info menu actions here as needed
      }

      // Handle user interactions with published info menus (non-admin users)
      if (ctx === "info-page") {
        const infoMenuId = parts[1];
        const pageId = parts[2];

        if (!infoMenuId || !pageId) {
          return sendEphemeralEmbed(interaction, "❌ Invalid menu or page.", "#FF0000", "Error", false);
        }

        const menu = db.getInfoMenu(infoMenuId);
        if (!menu) {
          return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
        }

        const page = db.getInfoMenuPage(infoMenuId, pageId);
        if (!page) {
          return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
        }

        try {
          // Create embed for the page content
          const embed = new EmbedBuilder();
          
          // Helper function to validate URLs
          const isValidUrl = (url) => {
            if (!url || typeof url !== 'string' || url.trim() === '') return false;
            try {
              new URL(url);
              return true;
            } catch {
              return false;
            }
          };

          // Helper function to validate color
          const isValidColor = (color) => {
            if (!color || typeof color !== 'string') return false;
            return /^#[0-9A-F]{6}$/i.test(color) || /^[0-9A-F]{6}$/i.test(color);
          };
          
          if (page.content.title && page.content.title.trim()) {
            embed.setTitle(page.content.title.slice(0, 256)); // Discord title limit
          }
          
          if (page.content.description && page.content.description.trim()) {
            embed.setDescription(page.content.description.slice(0, 4096)); // Discord description limit
          }
          
          // Handle color with validation
          const color = page.content.color || menu.embedColor;
          if (color && isValidColor(color)) {
            embed.setColor(color);
          }
          
          // Handle thumbnail with URL validation
          const thumbnail = page.content.thumbnail || menu.embedThumbnail;
          if (thumbnail && isValidUrl(thumbnail)) {
            embed.setThumbnail(thumbnail);
          }
          
          // Handle image with URL validation
          const image = page.content.image || menu.embedImage;
          if (image && isValidUrl(image)) {
            embed.setImage(image);
          }
          
          // Handle author with validation
          if (page.content.author && page.content.author.name) {
            const authorData = {
              name: page.content.author.name.slice(0, 256) // Discord author name limit
            };
            if (page.content.author.iconURL && isValidUrl(page.content.author.iconURL)) {
              authorData.iconURL = page.content.author.iconURL;
            }
            embed.setAuthor(authorData);
          } else if (menu.embedAuthorName) {
            const authorData = {
              name: menu.embedAuthorName.slice(0, 256)
            };
            if (menu.embedAuthorIconURL && isValidUrl(menu.embedAuthorIconURL)) {
              authorData.iconURL = menu.embedAuthorIconURL;
            }
            embed.setAuthor(authorData);
          }

          // Handle footer with validation
          if (page.content.footer && page.content.footer.text) {
            const footerData = {
              text: page.content.footer.text.slice(0, 2048) // Discord footer text limit
            };
            if (page.content.footer.iconURL && isValidUrl(page.content.footer.iconURL)) {
              footerData.iconURL = page.content.footer.iconURL;
            }
            embed.setFooter(footerData);
          } else if (menu.embedFooterText) {
            const footerData = {
              text: menu.embedFooterText.slice(0, 2048)
            };
            if (menu.embedFooterIconURL && isValidUrl(menu.embedFooterIconURL)) {
              footerData.iconURL = menu.embedFooterIconURL;
            }
            embed.setFooter(footerData);
          }

          // Handle fields with validation
          if (page.content.fields && Array.isArray(page.content.fields)) {
            const validFields = page.content.fields
              .filter(field => field && field.name && field.value)
              .slice(0, 25) // Discord field limit
              .map(field => ({
                name: field.name.slice(0, 256), // Discord field name limit
                value: field.value.slice(0, 1024), // Discord field value limit
                inline: Boolean(field.inline)
              }));
            
            if (validFields.length > 0) {
              embed.addFields(validFields);
            }
          }

          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            } else {
              await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
          } catch (replyError) {
            console.error("Error sending embed reply:", replyError);
            console.error("Embed data:", JSON.stringify({ embeds: [embed] }, null, 2));
            return sendEphemeralEmbed(interaction, "❌ Error displaying page content.", "#FF0000", "Error", false);
          }
        } catch (error) {
          console.error("Error displaying info page:", error);
          console.error("Page data:", JSON.stringify(page, null, 2));
          console.error("Menu data:", JSON.stringify(menu, null, 2));
          return sendEphemeralEmbed(interaction, "❌ Error displaying page content.", "#FF0000", "Error", false);
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

        if (action === "select_role_for_color") {
          const roleId = interaction.values[0];
          const menuId = parts[2];
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error", false);
          }
          
          const role = interaction.guild.roles.cache.get(roleId);
          if (!role) {
              return sendEphemeralEmbed(interaction, "Role not found.", "#FF0000", "Error", false);
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`rr:set_role_button_color:${menuId}:${roleId}`)
            .setPlaceholder("Choose button color...")
            .addOptions([
              { label: "Primary (Blue)", value: "Primary", emoji: "🔵" },
              { label: "Secondary (Gray)", value: "Secondary", emoji: "⚪" },
              { label: "Success (Green)", value: "Success", emoji: "🟢" },
              { label: "Danger (Red)", value: "Danger", emoji: "🔴" }
            ]);

          const row = new ActionRowBuilder().addComponents(selectMenu);
          
          await interaction.editReply({
            content: `🎨 **Change Button Color for ${role.name}**\n\nCurrent color: **${menu.buttonColors?.[roleId] || 'Primary'}**`,
            components: [row],
            flags: MessageFlags.Ephemeral
          });
        }

        // Bulk setup handlers - simplified
        if (action === "bulk_all_dropdown") {
          const hybridMenuId = parts[2];
          console.log(`[Bulk Debug] Starting bulk_all_dropdown for menu: ${hybridMenuId}`);
          
          try {
            console.log(`[Bulk Debug] Getting menu from database...`);
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Bulk Debug] Menu not found!`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            console.log(`[Bulk Debug] Menu found: ${menu.name}`);
            const updates = {
              defaultInfoDisplayType: 'dropdown',
              defaultRoleDisplayType: 'dropdown',
              displayTypes: {},
              roleDisplayTypes: {}
            };

            console.log(`[Bulk Debug] About to update database...`);
            await db.updateHybridMenu(hybridMenuId, updates);
            console.log(`[Bulk Debug] Database updated successfully`);
            
            console.log(`[Bulk Debug] About to send response...`);
            const result = await interaction.editReply({
              embeds: [new EmbedBuilder()
                .setTitle("✅ Success")
                .setDescription("All items set to dropdown display! Use 'Display Types Configuration' to see the changes.")
                .setColor("#00FF00")],
              flags: MessageFlags.Ephemeral
            });
            console.log(`[Bulk Debug] Response sent successfully:`, result);
            
            return result;
          } catch (error) {
            console.error("Error in bulk_all_dropdown:", error);
            console.error("Error stack:", error.stack);
            return sendEphemeralEmbed(interaction, "❌ Error setting bulk dropdown. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "bulk_all_buttons") {
          const hybridMenuId = parts[2];
          console.log(`[Bulk Debug] Starting bulk_all_buttons for menu: ${hybridMenuId}`);
          
          try {
            console.log(`[Bulk Debug] Getting menu from database...`);
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Bulk Debug] Menu not found!`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            console.log(`[Bulk Debug] Menu found: ${menu.name}`);
            const updates = {
              defaultInfoDisplayType: 'button',
              defaultRoleDisplayType: 'button',
              displayTypes: {},
              roleDisplayTypes: {}
            };

            console.log(`[Bulk Debug] About to update database...`);
            await db.updateHybridMenu(hybridMenuId, updates);
            console.log(`[Bulk Debug] Database updated successfully`);
            
            console.log(`[Bulk Debug] About to send response...`);
            const result = await interaction.editReply({
              embeds: [new EmbedBuilder()
                .setTitle("✅ Success")
                .setDescription("All items set to button display! Use 'Display Types Configuration' to see the changes.")
                .setColor("#00FF00")],
              flags: MessageFlags.Ephemeral
            });
            console.log(`[Bulk Debug] Response sent successfully:`, result);
            
            return result;
          } catch (error) {
            console.error("Error in bulk_all_buttons:", error);
            console.error("Error stack:", error.stack);
            return sendEphemeralEmbed(interaction, "❌ Error setting bulk buttons. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "bulk_all_both") {
          const hybridMenuId = parts[2];
          console.log(`[Bulk Debug] Starting bulk_all_both for menu: ${hybridMenuId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const updates = {
              defaultInfoDisplayType: 'both',
              defaultRoleDisplayType: 'both',
              displayTypes: {},
              roleDisplayTypes: {}
            };

            await db.updateHybridMenu(hybridMenuId, updates);
            
            return await interaction.editReply({
              embeds: [new EmbedBuilder()
                .setTitle("✅ Success")
                .setDescription("All items set to both dropdown and button display! Use 'Display Types Configuration' to see the changes.")
                .setColor("#00FF00")],
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error("Error in bulk_all_both:", error);
            return sendEphemeralEmbed(interaction, "❌ Error setting bulk both. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "bulk_info_dropdown_roles_button") {
          const hybridMenuId = parts[2];
          console.log(`[Bulk Debug] Starting bulk_info_dropdown_roles_button for menu: ${hybridMenuId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const updates = {
              defaultInfoDisplayType: 'dropdown',
              defaultRoleDisplayType: 'button',
              displayTypes: {},
              roleDisplayTypes: {}
            };

            await db.updateHybridMenu(hybridMenuId, updates);
            
            return await interaction.editReply({
              embeds: [new EmbedBuilder()
                .setTitle("✅ Success")
                .setDescription("Info pages set to dropdown, roles set to buttons! Use 'Display Types Configuration' to see the changes.")
                .setColor("#00FF00")],
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error("Error in bulk_info_dropdown_roles_button:", error);
            return sendEphemeralEmbed(interaction, "❌ Error setting bulk preferences. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "bulk_info_button_roles_dropdown") {
          const hybridMenuId = parts[2];
          console.log(`[Bulk Debug] Starting bulk_info_button_roles_dropdown for menu: ${hybridMenuId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const updates = {
              defaultInfoDisplayType: 'button',
              defaultRoleDisplayType: 'dropdown',
              displayTypes: {},
              roleDisplayTypes: {}
            };

            await db.updateHybridMenu(hybridMenuId, updates);
            
            return await interaction.editReply({
              embeds: [new EmbedBuilder()
                .setTitle("✅ Success")
                .setDescription("Info pages set to buttons, roles set to dropdown! Use 'Display Types Configuration' to see the changes.")
                .setColor("#00FF00")],
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error("Error in bulk_info_button_roles_dropdown:", error);
            return sendEphemeralEmbed(interaction, "❌ Error setting bulk preferences. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "toggle_page_display") {
          const hybridMenuId = parts[2];
          const pageId = parts[3];
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const page = menu.pages?.find(p => p.id === pageId);
            if (!page) {
              return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
            }

            const currentOverrides = menu.displayTypes || {};
            const currentOverride = currentOverrides[pageId];
            const defaultType = menu.defaultInfoDisplayType || 'dropdown';
            const currentType = currentOverride || defaultType;

            // Cycle through: dropdown -> button -> both -> hidden -> (remove override/use default)
            let newType;
            if (currentType === 'dropdown') {
              newType = 'button';
            } else if (currentType === 'button') {
              newType = 'both';
            } else if (currentType === 'both') {
              newType = 'hidden';
            } else if (currentType === 'hidden') {
              // Remove override (use default)
              newType = null;
            } else {
              newType = 'dropdown';
            }

            const updates = { displayTypes: { ...currentOverrides } };
            if (newType === null) {
              delete updates.displayTypes[pageId];
            } else {
              updates.displayTypes[pageId] = newType;
            }

            await db.updateHybridMenu(hybridMenuId, updates);

            const displayText = newType || `${defaultType} (default)`;
            await sendEphemeralEmbed(interaction, `✅ **${page.name}** display type set to: **${displayText}**`, "#00FF00", "Success", false);
            return showIndividualItemConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error("Error toggling page display:", error);
            return sendEphemeralEmbed(interaction, "❌ Error updating page display type. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "toggle_role_display") {
          const hybridMenuId = parts[2];
          const roleId = parts[3];
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) {
              return sendEphemeralEmbed(interaction, "❌ Role not found.", "#FF0000", "Error", false);
            }

            const currentOverrides = menu.roleDisplayTypes || {};
            const currentOverride = currentOverrides[roleId];
            const defaultType = menu.defaultRoleDisplayType || 'dropdown';
            const currentType = currentOverride || defaultType;

            // Cycle through: dropdown -> button -> both -> hidden -> (remove override/use default)
            let newType;
            if (currentType === 'dropdown') {
              newType = 'button';
            } else if (currentType === 'button') {
              newType = 'both';
            } else if (currentType === 'both') {
              newType = 'hidden';
            } else if (currentType === 'hidden') {
              // Remove override (use default)
              newType = null;
            } else {
              newType = 'dropdown';
            }

            const updates = { roleDisplayTypes: { ...currentOverrides } };
            if (newType === null) {
              delete updates.roleDisplayTypes[roleId];
            } else {
              updates.roleDisplayTypes[roleId] = newType;
            }

            await db.updateHybridMenu(hybridMenuId, updates);

            const displayText = newType || `${defaultType} (default)`;
            await sendEphemeralEmbed(interaction, `✅ **${role.name}** display type set to: **${displayText}**`, "#00FF00", "Success", false);
            return showIndividualItemConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error("Error toggling role display:", error);
            return sendEphemeralEmbed(interaction, "❌ Error updating role display type. Please try again.", "#FF0000", "Error", false);
          }
        }

      } else if (ctx === "info") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure information menus.", "#FF0000", "Permission Denied", false);
        }

        if (action === "selectmenu") {
          const infoMenuId = interaction.values[0];
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (action === "select_template") {
          const templateId = interaction.values[0];
          const template = db.getInfoMenu(templateId);
          if (!template || !template.isTemplate) {
            return sendEphemeralEmbed(interaction, "❌ Template not found or invalid.", "#FF0000", "Error", false);
          }

          const modal = new ModalBuilder()
            .setCustomId(`info:modal:create_from_template:${templateId}`)
            .setTitle(`Create from Template: ${template.templateName}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("new_name")
                  .setLabel("New Menu Name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("My Server Rules, My FAQ, etc.")
                  .setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("new_desc")
                  .setLabel("New Menu Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setPlaceholder("Description for your specific use of this template")
                  .setMaxLength(1000)
              )
            );
          return interaction.showModal(modal);
        }

        if (action === "page_action") {
          const infoMenuId = parts[2];
          const [pageAction, pageId] = interaction.values[0].split(":");

          if (!infoMenuId || !pageAction || !pageId) {
            return interaction.editReply({
              content: "❌ Invalid page action selection.",
              flags: MessageFlags.Ephemeral
            });
          }

          const menu = db.getInfoMenu(infoMenuId);
          if (!menu) {
            return interaction.editReply({
              content: "❌ Information menu not found.",
              flags: MessageFlags.Ephemeral
            });
          }

          const page = db.getInfoMenuPage(infoMenuId, pageId);
          if (!page) {
            return interaction.editReply({
              content: "❌ Page not found.",
              flags: MessageFlags.Ephemeral
            });
          }

          if (pageAction === "edit") {
            try {
              // Sanitize the page content before serializing to prevent JSON errors
              const sanitizedContent = {
                ...page.content,
                thumbnail: typeof page.content.thumbnail === 'string' ? page.content.thumbnail : 
                          (page.content.thumbnail?.url || null),
                image: typeof page.content.image === 'string' ? page.content.image : 
                       (page.content.image?.url || null),
                author: page.content.author ? {
                  name: page.content.author.name,
                  iconURL: typeof page.content.author.iconURL === 'string' ? page.content.author.iconURL : 
                          (page.content.author.iconURL?.url || null)
                } : null,
                footer: page.content.footer ? {
                  text: page.content.footer.text,
                  iconURL: typeof page.content.footer.iconURL === 'string' ? page.content.footer.iconURL : 
                          (page.content.footer.iconURL?.url || null)
                } : null
              };

              const pageJson = JSON.stringify({
                id: page.id,
                name: page.name,
                content: sanitizedContent
              }, null, 2);

              const modal = new ModalBuilder()
                .setCustomId(`info:modal:edit_page:${infoMenuId}:${pageId}`)
                .setTitle(`Edit Page: ${page.name}`)
                .addComponents(
                  new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                      .setCustomId("page_json")
                      .setLabel("Page Configuration (JSON)")
                      .setStyle(TextInputStyle.Paragraph)
                      .setRequired(true)
                      .setValue(pageJson)
                      .setMaxLength(4000)
                  )
                );
              return interaction.showModal(modal);
            } catch (jsonError) {
              console.error("Error serializing page data for edit:", jsonError);
              return interaction.editReply({
                content: "❌ Error preparing page data for editing. The page data may be corrupted.",
                flags: MessageFlags.Ephemeral
              });
            }
          } 
          
          if (pageAction === "delete") {
            const confirmButton = new ButtonBuilder()
              .setCustomId(`info:confirm_delete_page:${infoMenuId}:${pageId}`)
              .setLabel("Confirm Delete Page")
              .setStyle(ButtonStyle.Danger);
            const cancelButton = new ButtonBuilder()
              .setCustomId(`info:cancel_delete_page:${infoMenuId}`)
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            return interaction.editReply({
              content: `⚠️ Are you sure you want to delete the page "${page.name}"? This cannot be undone.`,
              components: [row],
              flags: MessageFlags.Ephemeral
            });
          }
        }

        if (action === "select_page_for_button_color") {
          const infoMenuId = parts[2];
          const selectedPageId = interaction.values[0];
          
          if (!infoMenuId || !selectedPageId) {
            return sendEphemeralEmbed(interaction, "❌ Menu or page ID missing.", "#FF0000", "Error", false);
          }

          const page = db.getInfoMenuPage(infoMenuId, selectedPageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          // Create modal for button color selection
          const modal = new ModalBuilder()
            .setCustomId(`info:modal:set_button_color:${infoMenuId}:${selectedPageId}`)
            .setTitle(`Set Button Color: ${page.name}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("button_color")
                  .setLabel("Button Color")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder("Primary, Secondary, Success, or Danger")
                  .setValue(page.buttonColor || "Primary")
                  .setMaxLength(20)
              )
            );
          
          return interaction.showModal(modal);
        }

        if (action === "select_page_for_description") {
          const infoMenuId = parts[2];
          const selectedPageId = interaction.values[0];
          
          if (!infoMenuId || !selectedPageId) {
            return sendEphemeralEmbed(interaction, "❌ Menu or page ID missing.", "#FF0000", "Error", false);
          }

          const page = db.getInfoMenuPage(infoMenuId, selectedPageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          // Create modal for description input
          const modal = new ModalBuilder()
            .setCustomId(`info:modal:set_page_description:${infoMenuId}:${selectedPageId}`)
            .setTitle(`Set Description: ${page.name}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_description")
                  .setLabel("Dropdown Description")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setPlaceholder("Brief description for the dropdown menu...")
                  .setValue(page.dropdownDescription || "")
                  .setMaxLength(100)
              )
            );
          
          return interaction.showModal(modal);
        }

        if (action === "select_page_for_emoji") {
          const infoMenuId = parts[2];
          const selectedPageId = interaction.values[0];
          
          if (!infoMenuId || !selectedPageId) {
            return sendEphemeralEmbed(interaction, "❌ Menu or page ID missing.", "#FF0000", "Error", false);
          }

          const page = db.getInfoMenuPage(infoMenuId, selectedPageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          // Create modal for emoji input
          const modal = new ModalBuilder()
            .setCustomId(`info:modal:set_page_emoji:${infoMenuId}:${selectedPageId}`)
            .setTitle(`Set Emoji: ${page.name}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("page_emoji")
                  .setLabel("Page Emoji")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("😀 Enter an emoji (or leave blank to remove)")
                  .setValue(page.emoji || "")
                  .setMaxLength(10)
              )
            );
          
          return interaction.showModal(modal);
        }
      } else if (ctx === "schedule") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to manage schedules.", "#FF0000", "Permission Denied", false);
        }

        if (action === "select_manage") {
          const scheduleId = interaction.values[0].replace("manage_schedule:", "");
          return showScheduleDetailsMenu(interaction, scheduleId);
        }
      } else if (ctx === "hybrid") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure hybrid menus.", "#FF0000", "Permission Denied", false);
        }

        if (action === "selectmenu") {
          const hybridMenuId = interaction.values[0];
          return showHybridMenuConfiguration(interaction, hybridMenuId);
        }

        if (action === "select_page_display_type") {
          const hybridMenuId = parts[2];
          const displayType = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing select_page_display_type for menu: ${hybridMenuId}, display type: ${displayType}`);
          
          try {
            const modal = new ModalBuilder()
              .setCustomId(`hybrid:modal:add_info_page_with_type:${hybridMenuId}:${displayType}`)
              .setTitle("Add Information Page")
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("title")
                    .setLabel("Page Title")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder("Enter page title (e.g., 'Server Rules')")
                    .setMaxLength(100)
                ),
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("description")
                    .setLabel("Page Description")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder("Enter the content for this page...")
                    .setMaxLength(4000)
                ),
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("emoji")
                    .setLabel("Page Emoji (optional)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder("📋")
                    .setMaxLength(10)
                )
              );
            return interaction.showModal(modal);
          } catch (error) {
            console.error(`[Hybrid Debug] Error showing modal for display type ${displayType}:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error showing page creation form. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "select_dropdown_role") {
          const hybridMenuId = parts[2];
          const selectedRoleIds = interaction.values;
          
          console.log(`[Hybrid Debug] Processing select_dropdown_role for menu: ${hybridMenuId}, roles: ${selectedRoleIds.join(', ')}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Hybrid Debug] Hybrid menu not found: ${hybridMenuId}`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const currentDropdownRoles = menu.dropdownRoles || [];
            const updatedDropdownRoles = [...currentDropdownRoles, ...selectedRoleIds];

            await db.updateHybridMenu(hybridMenuId, { dropdownRoles: updatedDropdownRoles });

            console.log(`[Hybrid Debug] Successfully added ${selectedRoleIds.length} roles to dropdown`);
            // Pass success message to the configuration function
            return showHybridRolesConfiguration(interaction, hybridMenuId, `✅ Added ${selectedRoleIds.length} role(s) to dropdown!`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in select_dropdown_role:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error adding roles to dropdown. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "select_button_role") {
          const hybridMenuId = parts[2];
          const selectedRoleIds = interaction.values;
          
          console.log(`[Hybrid Debug] Processing select_button_role for menu: ${hybridMenuId}, roles: ${selectedRoleIds.join(', ')}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Hybrid Debug] Hybrid menu not found: ${hybridMenuId}`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const currentButtonRoles = menu.buttonRoles || [];
            const updatedButtonRoles = [...currentButtonRoles, ...selectedRoleIds];

            await db.updateHybridMenu(hybridMenuId, { buttonRoles: updatedButtonRoles });

            console.log(`[Hybrid Debug] Successfully added ${selectedRoleIds.length} roles as buttons`);
            // Pass success message to the configuration function
            return showHybridRolesConfiguration(interaction, hybridMenuId, `✅ Added ${selectedRoleIds.length} role(s) as buttons!`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in select_button_role:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error adding roles as buttons. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "save_info_display") {
          const hybridMenuId = parts[2];
          const displayType = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing save_info_display for menu: ${hybridMenuId}, display type: ${displayType}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Hybrid Debug] Hybrid menu not found: ${hybridMenuId}`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const infoSelectionType = displayType === "both" ? ["dropdown", "button"] : [displayType];
            await db.updateHybridMenu(hybridMenuId, { 
              infoSelectionType, // Keep legacy field for compatibility
              defaultInfoDisplayType: displayType // New field
            });

            console.log(`[Hybrid Debug] Successfully set info display type to: ${displayType}`);
            // Pass success message to the configuration function
            return showHybridInfoConfiguration(interaction, hybridMenuId, `✅ Info pages display type set to: ${displayType}`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in save_info_display:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error saving info display type. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "save_role_display") {
          const hybridMenuId = parts[2];
          const displayType = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing save_role_display for menu: ${hybridMenuId}, display type: ${displayType}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Hybrid Debug] Hybrid menu not found: ${hybridMenuId}`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const roleSelectionType = displayType === "both" ? ["dropdown", "button"] : [displayType];
            await db.updateHybridMenu(hybridMenuId, { 
              roleSelectionType, // Keep legacy field for compatibility
              defaultRoleDisplayType: displayType // New field
            });

            console.log(`[Hybrid Debug] Successfully set role display type to: ${displayType}`);
            // Pass success message to the configuration function
            return showHybridRolesConfiguration(interaction, hybridMenuId, `✅ Roles display type set to: ${displayType}`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in save_role_display:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error saving role display type. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "set_role_button_color") {
          const menuId = parts[2];
          const roleId = parts[3];
          const buttonColor = interaction.values[0];
          
          console.log(`[RR Debug] Setting button color for role ${roleId} to ${buttonColor}`);
          
          try {
            const menu = db.getMenu(menuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Menu not found.", "#FF0000", "Error", false);
            }

            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) {
              return sendEphemeralEmbed(interaction, "❌ Role not found.", "#FF0000", "Error", false);
            }

            // Update the role button color
            const buttonColors = menu.buttonColors || {};
            buttonColors[roleId] = buttonColor;
            
            await db.updateMenu(menuId, { buttonColors: buttonColors });
            
            await sendEphemeralEmbed(interaction, `✅ Button color for **${role.name}** set to **${buttonColor}**!`, "#00FF00", "Success", false);
            return showMenuConfiguration(interaction, menuId);
          } catch (error) {
            console.error(`[RR Debug] Error setting button color:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error setting button color. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "set_page_button_color") {
          const hybridMenuId = parts[2];
          const pageId = parts[3];
          const buttonColor = interaction.values[0];
          
          console.log(`[Hybrid Debug] Setting button color for page ${pageId} to ${buttonColor}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const page = menu.pages?.find(p => p.id === pageId);
            if (!page) {
              return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
            }

            // Update the page button color
            const updatedPages = menu.pages.map(p => 
              p.id === pageId ? { ...p, buttonColor: buttonColor } : p
            );
            
            await db.updateHybridMenu(hybridMenuId, { pages: updatedPages });
            
            await sendEphemeralEmbed(interaction, `✅ Button color for "${page.name || page.title || 'Untitled Page'}" set to **${buttonColor}**!`, "#00FF00", "Success", false);
            return showHybridInfoConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error setting button color:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error setting button color. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "manage_info_page") {
          const hybridMenuId = parts[2];
          const pageId = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing manage_info_page for menu: ${hybridMenuId}, page: ${pageId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Hybrid Debug] Hybrid menu not found: ${hybridMenuId}`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const page = menu.pages?.find(p => p.id === pageId);
            if (!page) {
              console.log(`[Hybrid Debug] Page not found: ${pageId}`);
              return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
            }

            // Show page management options
            const embed = new EmbedBuilder()
              .setTitle(`📝 Manage Page: ${page.name || page.title || 'Untitled Page'}`)
              .setDescription(`**Page Content:**\n${(page.content || page.description || 'No content').substring(0, 1000)}${(page.content || page.description || '').length > 1000 ? '...' : ''}`)
              .setColor("#5865F2")
              .addFields([
                { name: "Display Type", value: page.displayType || 'dropdown', inline: true },
                { name: "Button Color", value: page.buttonColor || 'Primary', inline: true },
                { name: "Emoji", value: page.emoji || 'None', inline: true },
                { name: "Created", value: page.createdAt ? new Date(page.createdAt).toLocaleDateString() : "Unknown", inline: true },
                { name: "Updated", value: page.updatedAt ? new Date(page.updatedAt).toLocaleDateString() : "Not updated", inline: true },
                { name: "Page ID", value: page.id, inline: true }
              ]);

            const actionRow1 = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`hybrid:edit_info_page:${hybridMenuId}:${pageId}`)
                .setLabel("Edit Page")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("✏️"),
              new ButtonBuilder()
                .setCustomId(`hybrid:change_page_display_type:${hybridMenuId}:${pageId}`)
                .setLabel("Change Display Type")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🔄"),
              new ButtonBuilder()
                .setCustomId(`hybrid:change_page_button_color:${hybridMenuId}:${pageId}`)
                .setLabel("Button Color")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🎨")
            );

            const actionRow2 = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`hybrid:delete_info_page:${hybridMenuId}:${pageId}`)
                .setLabel("Delete Page")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("🗑️"),
              new ButtonBuilder()
                .setCustomId(`hybrid:back_to_info_config:${hybridMenuId}`)
                .setLabel("Back")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("⬅️")
            );

            const responseData = { embeds: [embed], components: [actionRow1, actionRow2], flags: MessageFlags.Ephemeral };
            
            if (interaction.deferred || interaction.replied) {
              await interaction.editReply(responseData);
            } else {
              await interaction.reply(responseData);
            }

            console.log(`[Hybrid Debug] Successfully showed page management for page: ${pageId}`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in manage_info_page:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error managing page. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "manage_role") {
          const hybridMenuId = parts[2];
          const roleValue = interaction.values[0]; // Format: "dropdown_roleId" or "button_roleId"
          const [roleType, roleId] = roleValue.split('_');
          
          console.log(`[Hybrid Debug] Processing manage_role for menu: ${hybridMenuId}, role: ${roleId}, type: ${roleType}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              console.log(`[Hybrid Debug] Hybrid menu not found: ${hybridMenuId}`);
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) {
              console.log(`[Hybrid Debug] Role not found: ${roleId}`);
              return sendEphemeralEmbed(interaction, "❌ Role not found.", "#FF0000", "Error", false);
            }

            // Show role management options
            const embed = new EmbedBuilder()
              .setTitle(`🎭 Manage Role: ${role.name}`)
              .setDescription(`**Role Information:**\nName: ${role.name}\nID: ${role.id}\nType: ${roleType.charAt(0).toUpperCase() + roleType.slice(1)}\nMembers: ${role.members.size}`)
              .setColor(role.color || "#5865F2")
              .addFields([
                { name: "Position", value: role.position.toString(), inline: true },
                { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
                { name: "Hoisted", value: role.hoist ? "Yes" : "No", inline: true }
              ]);

            const actionRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`hybrid:edit_role:${hybridMenuId}:${roleType}:${roleId}`)
                .setLabel("Edit Role Settings")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("✏️"),
              new ButtonBuilder()
                .setCustomId(`hybrid:remove_role:${hybridMenuId}:${roleType}:${roleId}`)
                .setLabel("Remove Role")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("🗑️"),
              new ButtonBuilder()
                .setCustomId(`hybrid:back_to_roles_config:${hybridMenuId}`)
                .setLabel("Back")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("⬅️")
            );

            const responseData = { embeds: [embed], components: [actionRow], flags: MessageFlags.Ephemeral };
            
            if (interaction.deferred || interaction.replied) {
              await interaction.editReply(responseData);
            } else {
              await interaction.reply(responseData);
            }

            console.log(`[Hybrid Debug] Successfully showed role management for role: ${roleId}`);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in manage_role:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error managing role. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "save_info_default") {
          const hybridMenuId = parts[2];
          const selectedType = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing save_info_default for menu: ${hybridMenuId}, type: ${selectedType}`);
          
          try {
            await db.updateHybridMenu(hybridMenuId, { defaultInfoDisplayType: selectedType });
            
            console.log(`[Hybrid Debug] Successfully saved info default: ${selectedType}`);
            await sendEphemeralEmbed(interaction, `✅ Info pages default display type set to: ${selectedType}!`, "#00FF00", "Success", false);
            return showHybridDisplayTypesConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in save_info_default:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error saving info default. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "save_role_default") {
          const hybridMenuId = parts[2];
          const selectedType = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing save_role_default for menu: ${hybridMenuId}, type: ${selectedType}`);
          
          try {
            await db.updateHybridMenu(hybridMenuId, { defaultRoleDisplayType: selectedType });
            
            console.log(`[Hybrid Debug] Successfully saved role default: ${selectedType}`);
            await sendEphemeralEmbed(interaction, `✅ Role default display type set to: ${selectedType}!`, "#00FF00", "Success", false);
            return showHybridDisplayTypesConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in save_role_default:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error saving role default. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "select_page_override") {
          const hybridMenuId = parts[2];
          const pageId = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing select_page_override for menu: ${hybridMenuId}, page: ${pageId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const page = menu.pages.find(p => p.id === pageId);
            if (!page) {
              return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
            }

            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(`hybrid:save_page_override:${hybridMenuId}:${pageId}`)
              .setPlaceholder("Choose display type for this page...")
              .addOptions([
                { label: "Dropdown Only", value: "dropdown", description: "Show this page as dropdown option only" },
                { label: "Buttons Only", value: "button", description: "Show this page as button only" },
                { label: "Both Dropdown and Buttons", value: "both", description: "Show this page as both dropdown and button" },
                { label: "Hidden", value: "hidden", description: "Hide this page from published menu" }
              ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            await interaction.editReply({
              content: `🎯 **Override Display Type for "${page.name}"**\n\nThis will override the menu-wide default:`,
              components: [row],
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error(`[Hybrid Debug] Error in select_page_override:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error showing page override options. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "select_role_override") {
          const hybridMenuId = parts[2];
          const roleId = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing select_role_override for menu: ${hybridMenuId}, role: ${roleId}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) {
              return sendEphemeralEmbed(interaction, "❌ Role not found.", "#FF0000", "Error", false);
            }

            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(`hybrid:save_role_override:${hybridMenuId}:${roleId}`)
              .setPlaceholder("Choose display type for this role...")
              .addOptions([
                { label: "Dropdown Only", value: "dropdown", description: "Show this role as dropdown option only" },
                { label: "Buttons Only", value: "button", description: "Show this role as button only" },
                { label: "Both Dropdown and Buttons", value: "both", description: "Show this role as both dropdown and button" },
                { label: "Hidden", value: "hidden", description: "Hide this role from published menu" }
              ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            await interaction.editReply({
              content: `🎯 **Override Display Type for "${role.name}"**\n\nThis will override the menu-wide default:`,
              components: [row],
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error(`[Hybrid Debug] Error in select_role_override:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error showing role override options. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "save_page_override") {
          const hybridMenuId = parts[2];
          const pageId = parts[3];
          const selectedType = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing save_page_override for menu: ${hybridMenuId}, page: ${pageId}, type: ${selectedType}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const displayTypes = menu.displayTypes || {};
            
            if (selectedType === "hidden") {
              displayTypes[pageId] = [];
            } else if (selectedType === "dropdown") {
              displayTypes[pageId] = ["dropdown"];
            } else if (selectedType === "button") {
              displayTypes[pageId] = ["button"];
            } else if (selectedType === "both") {
              displayTypes[pageId] = ["dropdown", "button"];
            }

            await db.updateHybridMenu(hybridMenuId, { displayTypes });
            
            console.log(`[Hybrid Debug] Successfully saved page override: ${selectedType}`);
            await sendEphemeralEmbed(interaction, `✅ Page display type override saved: ${selectedType}!`, "#00FF00", "Success", false);
            return showHybridDisplayTypesConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in save_page_override:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error saving page override. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (action === "save_role_override") {
          const hybridMenuId = parts[2];
          const roleId = parts[3];
          const selectedType = interaction.values[0];
          
          console.log(`[Hybrid Debug] Processing save_role_override for menu: ${hybridMenuId}, role: ${roleId}, type: ${selectedType}`);
          
          try {
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }

            const roleDisplayTypes = menu.roleDisplayTypes || {};
            
            if (selectedType === "hidden") {
              roleDisplayTypes[roleId] = [];
            } else if (selectedType === "dropdown") {
              roleDisplayTypes[roleId] = ["dropdown"];
            } else if (selectedType === "button") {
              roleDisplayTypes[roleId] = ["button"];
            } else if (selectedType === "both") {
              roleDisplayTypes[roleId] = ["dropdown", "button"];
            }

            await db.updateHybridMenu(hybridMenuId, { roleDisplayTypes });
            
            console.log(`[Hybrid Debug] Successfully saved role override: ${selectedType}`);
            await sendEphemeralEmbed(interaction, `✅ Role display type override saved: ${selectedType}!`, "#00FF00", "Success", false);
            return showHybridDisplayTypesConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Debug] Error in save_role_override:`, error);
            return sendEphemeralEmbed(interaction, "❌ Error saving role override. Please try again.", "#FF0000", "Error", false);
          }
        }

      } else if (interaction.customId.startsWith("info-menu-select:")) {
        // Handle user selecting a page from published info menu dropdown
        const parts = interaction.customId.split(":");
        const infoMenuId = parts[1];
        const selectedPageId = interaction.values[0];

        if (!infoMenuId || !selectedPageId) {
          return sendEphemeralEmbed(interaction, "❌ Invalid menu or page selection.", "#FF0000", "Error", false);
        }

        const menu = db.getInfoMenu(infoMenuId);
        if (!menu) {
          return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
        }

        const page = db.getInfoMenuPage(infoMenuId, selectedPageId);
        if (!page) {
          return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
        }

        try {
          // Create embed for the page content
          const embed = new EmbedBuilder();
          
          // Helper function to validate URLs
          const isValidUrl = (url) => {
            if (!url || typeof url !== 'string' || url.trim() === '') return false;
            try {
              new URL(url);
              return true;
            } catch {
              return false;
            }
          };

          // Helper function to validate color
          const isValidColor = (color) => {
            if (!color || typeof color !== 'string') return false;
            return /^#[0-9A-F]{6}$/i.test(color) || /^[0-9A-F]{6}$/i.test(color);
          };
          
          if (page.content.title && page.content.title.trim()) {
            embed.setTitle(page.content.title.slice(0, 256)); // Discord title limit
          }
          
          if (page.content.description && page.content.description.trim()) {
            embed.setDescription(page.content.description.slice(0, 4096)); // Discord description limit
          }
          
          // Handle color with validation - use custom page color if available, otherwise menu color
          const color = page.color || page.content.color || menu.embedColor;
          if (color && isValidColor(color)) {
            embed.setColor(color);
          }
          
          // Handle thumbnail with URL validation
          const thumbnail = page.content.thumbnail || menu.embedThumbnail;
          if (thumbnail && isValidUrl(thumbnail)) {
            embed.setThumbnail(thumbnail);
          }
          
          // Handle image with URL validation
          const image = page.content.image || menu.embedImage;
          if (image && isValidUrl(image)) {
            embed.setImage(image);
          }
          
          // Handle author with validation
          if (page.content.author && page.content.author.name) {
            const authorData = {
              name: page.content.author.name.slice(0, 256) // Discord author name limit
            };
            if (page.content.author.iconURL && isValidUrl(page.content.author.iconURL)) {
              authorData.iconURL = page.content.author.iconURL;
            }
            embed.setAuthor(authorData);
          } else if (menu.embedAuthorName) {
            const authorData = {
              name: menu.embedAuthorName.slice(0, 256)
            };
            if (menu.embedAuthorIconURL && isValidUrl(menu.embedAuthorIconURL)) {
              authorData.iconURL = menu.embedAuthorIconURL;
            }
            embed.setAuthor(authorData);
          }

          // Handle footer with validation
          if (page.content.footer && page.content.footer.text) {
            const footerData = {
              text: page.content.footer.text.slice(0, 2048) // Discord footer text limit
            };
            if (page.content.footer.iconURL && isValidUrl(page.content.footer.iconURL)) {
              footerData.iconURL = page.content.footer.iconURL;
            }
            embed.setFooter(footerData);
          } else if (menu.embedFooterText) {
            const footerData = {
              text: menu.embedFooterText.slice(0, 2048)
            };
            if (menu.embedFooterIconURL && isValidUrl(menu.embedFooterIconURL)) {
              footerData.iconURL = menu.embedFooterIconURL;
            }
            embed.setFooter(footerData);
          }

          // Handle fields with validation
          if (page.content.fields && Array.isArray(page.content.fields)) {
            const validFields = page.content.fields
              .filter(field => field && field.name && field.value)
              .slice(0, 25) // Discord field limit
              .map(field => ({
                name: field.name.slice(0, 256), // Discord field name limit
                value: field.value.slice(0, 1024), // Discord field value limit
                inline: Boolean(field.inline)
              }));
            
            if (validFields.length > 0) {
              embed.addFields(validFields);
            }
          }

          try {
            // Since published dropdown interactions use deferUpdate, use followUp
            await interaction.followUp({ embeds: [embed], ephemeral: true });

            // Don't update the original message components - this prevents "edited" marks
            // The dropdown will naturally appear unselected after the interaction
          } catch (replyError) {
            console.error("Error sending embed reply:", replyError);
            console.error("Embed data:", JSON.stringify({ embeds: [embed] }, null, 2));
            return interaction.followUp({ content: "❌ Error displaying page content.", ephemeral: true });
          }
        } catch (error) {
          console.error("Error displaying info page from dropdown:", error);
          console.error("Page data:", JSON.stringify(page, null, 2));
          console.error("Menu data:", JSON.stringify(menu, null, 2));
          return interaction.followUp({ content: "❌ Error displaying page content.", ephemeral: true });
        }
      } else if (interaction.customId.startsWith("info-page:")) {
        // Handle user selecting a page from published info menu button
        const parts = interaction.customId.split(":");
        const infoMenuId = parts[1];
        const selectedPageId = parts[2];

        if (!infoMenuId || !selectedPageId) {
          return sendEphemeralEmbed(interaction, "❌ Invalid menu or page selection.", "#FF0000", "Error", false);
        }

        const menu = db.getInfoMenu(infoMenuId);
        if (!menu) {
          return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
        }

        const page = db.getInfoMenuPage(infoMenuId, selectedPageId);
        if (!page) {
          return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
        }

        try {
          // Create embed for the page content
          const embed = new EmbedBuilder();
          
          // Helper function to validate URLs
          const isValidUrl = (url) => {
            if (!url || typeof url !== 'string' || url.trim() === '') return false;
            try {
              new URL(url);
              return true;
            } catch {
              return false;
            }
          };

          // Helper function to validate color
          const isValidColor = (color) => {
            if (!color || typeof color !== 'string') return false;
            return /^#[0-9A-F]{6}$/i.test(color) || /^[0-9A-F]{6}$/i.test(color);
          };
          
          if (page.content.title && page.content.title.trim()) {
            embed.setTitle(page.content.title.slice(0, 256)); // Discord title limit
          }
          
          if (page.content.description && page.content.description.trim()) {
            embed.setDescription(page.content.description.slice(0, 4096)); // Discord description limit
          }
          
          // Handle color with validation - use custom page color if available, otherwise menu color
          const color = page.color || page.content.color || menu.embedColor;
          if (color && isValidColor(color)) {
            embed.setColor(color);
          }
          
          // Handle thumbnail with URL validation
          const thumbnail = page.content.thumbnail || menu.embedThumbnail;
          if (thumbnail && isValidUrl(thumbnail)) {
            embed.setThumbnail(thumbnail);
          }
          
          // Handle image with URL validation
          const image = page.content.image || menu.embedImage;
          if (image && isValidUrl(image)) {
            embed.setImage(image);
          }
          
          // Handle author with validation
          if (page.content.author && page.content.author.name) {
            const authorData = {
              name: page.content.author.name.slice(0, 256) // Discord author name limit
            };
            if (page.content.author.iconURL && isValidUrl(page.content.author.iconURL)) {
              authorData.iconURL = page.content.author.iconURL;
            }
            embed.setAuthor(authorData);
          } else if (menu.embedAuthorName) {
            const authorData = {
              name: menu.embedAuthorName.slice(0, 256)
            };
            if (menu.embedAuthorIconURL && isValidUrl(menu.embedAuthorIconURL)) {
              authorData.iconURL = menu.embedAuthorIconURL;
            }
            embed.setAuthor(authorData);
          }

          // Handle footer with validation
          if (page.content.footer && page.content.footer.text) {
            const footerData = {
              text: page.content.footer.text.slice(0, 2048) // Discord footer text limit
            };
            if (page.content.footer.iconURL && isValidUrl(page.content.footer.iconURL)) {
              footerData.iconURL = page.content.footer.iconURL;
            }
            embed.setFooter(footerData);
          } else if (menu.embedFooterText) {
            const footerData = {
              text: menu.embedFooterText.slice(0, 2048)
            };
            if (menu.embedFooterIconURL && isValidUrl(menu.embedFooterIconURL)) {
              footerData.iconURL = menu.embedFooterIconURL;
            }
            embed.setFooter(footerData);
          }

          // Handle fields with validation
          if (page.content.fields && Array.isArray(page.content.fields)) {
            const validFields = page.content.fields
              .filter(field => field && field.name && field.value)
              .slice(0, 25) // Discord field limit
              .map(field => ({
                name: field.name.slice(0, 256), // Discord field name limit
                value: field.value.slice(0, 1024), // Discord field value limit
                inline: Boolean(field.inline)
              }));
            
            if (validFields.length > 0) {
              embed.addFields(validFields);
            }
          }

          // Since published menu interactions are always deferred, use editReply
          await sendEphemeralEmbed(interaction, embed, null, null, false);
        } catch (error) {
          console.error("Error displaying info page from button:", error);
          console.error("Page data:", JSON.stringify(page, null, 2));
          console.error("Menu data:", JSON.stringify(menu, null, 2));
          return sendEphemeralEmbed(interaction, "❌ Error displaying page content.", "#FF0000", "Error", false);
        }
      } else if (interaction.customId.startsWith("info-page:")) {
        // Handle user clicking a page button from published info menu
        const parts = interaction.customId.split(":");
        const infoMenuId = parts[1];
        const selectedPageId = parts[2];

        if (!infoMenuId || !selectedPageId) {
          return sendEphemeralEmbed(interaction, "❌ Invalid menu or page selection.", "#FF0000", "Error", false);
        }

        const menu = db.getInfoMenu(infoMenuId);
        if (!menu) {
          return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
        }

        const page = db.getInfoMenuPage(infoMenuId, selectedPageId);
        if (!page) {
          return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
        }

        try {
          // Create embed for the page content
          const embed = new EmbedBuilder();
          
          // Helper function to validate URLs
          const isValidUrl = (url) => {
            if (!url || typeof url !== 'string' || url.trim() === '') return false;
            try {
              new URL(url);
              return true;
            } catch {
              return false;
            }
          };

          // Helper function to validate color
          const isValidColor = (color) => {
            if (!color || typeof color !== 'string') return false;
            return /^#[0-9A-F]{6}$/i.test(color) || /^[0-9A-F]{6}$/i.test(color);
          };
          
          if (page.content.title && page.content.title.trim()) {
            embed.setTitle(page.content.title.slice(0, 256));
          }
          
          if (page.content.description && page.content.description.trim()) {
            embed.setDescription(page.content.description.slice(0, 4096));
          }
          
          // Handle color with validation - use custom page color if available, otherwise menu color
          const color = page.color || page.content.color || menu.embedColor;
          if (color && isValidColor(color)) {
            embed.setColor(color);
          }
          
          // Handle thumbnail with URL validation
          const thumbnail = page.content.thumbnail || menu.embedThumbnail;
          if (thumbnail && isValidUrl(thumbnail)) {
            embed.setThumbnail(thumbnail);
          }
          
          // Handle image with URL validation
          const image = page.content.image || menu.embedImage;
          if (image && isValidUrl(image)) {
            embed.setImage(image);
          }
          
          // Handle author with validation
          if (page.content.author && page.content.author.name) {
            const authorData = {
              name: page.content.author.name.slice(0, 256)
            };
            if (page.content.author.iconURL && isValidUrl(page.content.author.iconURL)) {
              authorData.iconURL = page.content.author.iconURL;
            }
            embed.setAuthor(authorData);
          } else if (menu.embedAuthorName) {
            const authorData = {
              name: menu.embedAuthorName.slice(0, 256)
            };
            if (menu.embedAuthorIconURL && isValidUrl(menu.embedAuthorIconURL)) {
              authorData.iconURL = menu.embedAuthorIconURL;
            }
            embed.setAuthor(authorData);
          }

          // Handle footer with validation
          if (page.content.footer && page.content.footer.text) {
            const footerData = {
              text: page.content.footer.text.slice(0, 2048)
            };
            if (page.content.footer.iconURL && isValidUrl(page.content.footer.iconURL)) {
              footerData.iconURL = page.content.footer.iconURL;
            }
            embed.setFooter(footerData);
          } else if (menu.embedFooterText) {
            const footerData = {
              text: menu.embedFooterText.slice(0, 2048)
            };
            if (menu.embedFooterIconURL && isValidUrl(menu.embedFooterIconURL)) {
              footerData.iconURL = menu.embedFooterIconURL;
            }
            embed.setFooter(footerData);
          }

          // Handle fields with validation
          if (page.content.fields && Array.isArray(page.content.fields)) {
            const validFields = page.content.fields
              .filter(field => field && field.name && field.value)
              .slice(0, 25)
              .map(field => ({
                name: field.name.slice(0, 256),
                value: field.value.slice(0, 1024),
                inline: Boolean(field.inline)
              }));
            
            if (validFields.length > 0) {
              embed.addFields(validFields);
            }
          }

          await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (error) {
          console.error("Error displaying info page from button:", error);
          return sendEphemeralEmbed(interaction, "❌ Error displaying page content.", "#FF0000", "Error", false);
        }
      } else if (interaction.customId.startsWith("rr-role-select:")) {
          return handleRoleInteraction(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      console.log(`[Modal] Modal submission detected with customId: ${interaction.customId}`);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate().catch(e => console.error("Error deferring modal update:", e));
      }

      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const modalType = parts[2];
      
      console.log(`[Modal] Parsed parts - ctx: ${ctx}, action: ${action}, modalType: ${modalType}`);

      let menuId;
      let type;
      let roleId;

      if (ctx === "schedule" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.editReply({ content: "❌ You need Administrator permissions to schedule messages.", components: [], flags: MessageFlags.Ephemeral });
        }

        if (modalType === "create") {
          console.log("Schedule: Processing modal submission for menu", parts[3]);
          const targetMenuId = parts[3];
          const channelId = interaction.fields.getTextInputValue("channel_id");
          const scheduleTime = interaction.fields.getTextInputValue("schedule_time");
          const messageText = interaction.fields.getTextInputValue("message_text") || "";

          // Validate channel
          const channel = interaction.guild.channels.cache.get(channelId);
          if (!channel || !channel.isTextBased()) {
            return interaction.editReply({ content: "❌ Invalid channel ID. Please provide a valid text channel ID.", components: [], flags: MessageFlags.Ephemeral });
          }

          // Validate date format
          const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
          if (!dateRegex.test(scheduleTime)) {
            return interaction.editReply({ content: "❌ Invalid date format. Please use YYYY-MM-DD HH:MM (e.g., 2024-12-25 14:30)", components: [], flags: MessageFlags.Ephemeral });
          }

          // Parse and validate the date
          const scheduledDate = new Date(scheduleTime);
          if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
            return interaction.editReply({ content: "❌ Invalid date or date is in the past. Please provide a future date.", components: [], flags: MessageFlags.Ephemeral });
          }

          // Create schedule entry
          const scheduleId = generateId();
          const scheduleEntry = {
            id: scheduleId,
            menuId: targetMenuId,
            channelId: channelId,
            scheduledTime: scheduledDate.toISOString(),
            messageText: messageText,
            guildId: interaction.guild.id,
            createdBy: interaction.user.id,
            createdAt: new Date().toISOString(),
            status: 'scheduled'
          };

          // Save to database
          try {
            scheduledMessages.set(scheduleId, scheduleEntry);
            db.saveScheduledMessage(scheduleEntry);
            
            const embed = new EmbedBuilder()
              .setTitle("✅ Message Scheduled Successfully")
              .setDescription(`Your message has been scheduled for ${scheduleTime}`)
              .setColor("#00FF00")
              .addFields([
                { name: "Channel", value: `<#${channelId}>`, inline: true },
                { name: "Menu", value: db.getInfoMenu(targetMenuId)?.name || "Unknown", inline: true },
                { name: "Scheduled Time", value: `<t:${Math.floor(scheduledDate.getTime() / 1000)}:F>`, inline: false }
              ]);

            await interaction.editReply({ embeds: [embed], components: [], flags: MessageFlags.Ephemeral });
          } catch (error) {
            console.error("Error saving scheduled message:", error);
            await interaction.editReply({ content: "❌ Error saving scheduled message. Please try again.", components: [], flags: MessageFlags.Ephemeral });
          }
        }

        if (modalType === "create_direct") {
          console.log("Schedule: Processing direct modal submission");
          const channelId = interaction.fields.getTextInputValue("channel_id");
          const scheduleTime = interaction.fields.getTextInputValue("schedule_time");
          const messageJson = interaction.fields.getTextInputValue("message_json");
          const recurringInterval = interaction.fields.getTextInputValue("recurring_interval") || "";
          const duration = interaction.fields.getTextInputValue("duration") || "";

          // Validate channel
          const channel = interaction.guild.channels.cache.get(channelId);
          if (!channel || !channel.isTextBased()) {
            return interaction.editReply({ content: "❌ Invalid channel ID. Please provide a valid text channel ID.", components: [], flags: MessageFlags.Ephemeral });
          }

          // Validate date format (if provided)
          let scheduledDate;
          if (scheduleTime && scheduleTime.trim()) {
            const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
            if (!dateRegex.test(scheduleTime)) {
              return interaction.editReply({ content: "❌ Invalid date format. Please use YYYY-MM-DD HH:MM (e.g., 2024-12-25 14:30)", components: [], flags: MessageFlags.Ephemeral });
            }

            // Parse and validate the date
            scheduledDate = new Date(scheduleTime);
            if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
              return interaction.editReply({ content: "❌ Invalid date or date is in the past. Please provide a future date.", components: [], flags: MessageFlags.Ephemeral });
            }
          } else {
            // If no schedule time provided, start immediately
            scheduledDate = new Date();
          }

          // Validate JSON
          let parsedMessage;
          try {
            parsedMessage = JSON.parse(messageJson);
          } catch (jsonError) {
            return interaction.editReply({ content: "❌ Invalid JSON format. Please provide valid JSON for the message.", components: [], flags: MessageFlags.Ephemeral });
          }

          // Validate and parse recurring interval FIRST
          let recurringMs = null;
          let recurringDisplay = null;
          let isRecurring = false;
          if (recurringInterval) {
            const lower = recurringInterval.toLowerCase().trim();
            if (lower === "daily" || lower === "day") {
              recurringMs = 24 * 60 * 60 * 1000; // 24 hours in ms
              recurringDisplay = "Daily";
              isRecurring = true;
            } else if (lower === "weekly" || lower === "week") {
              recurringMs = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
              recurringDisplay = "Weekly";
              isRecurring = true;
            } else if (lower === "hourly" || lower === "hour") {
              recurringMs = 60 * 60 * 1000; // 1 hour in ms
              recurringDisplay = "Hourly";
              isRecurring = true;
            } else {
              // Try to parse as minutes
              const minutes = parseInt(lower);
              if (!isNaN(minutes) && minutes > 0) {
                recurringMs = minutes * 60 * 1000;
                recurringDisplay = `Every ${minutes} minutes`;
                isRecurring = true;
              } else {
                return interaction.editReply({ content: "❌ Invalid recurring interval. Use 'daily', 'weekly', 'hourly', or a number of minutes (e.g., 30).", components: [], flags: MessageFlags.Ephemeral });
              }
            }
          }

          // Validate duration if provided (only for non-recurring messages)
          let autoDeletDuration = null;
          if (duration && !isRecurring) {
            const durationNum = parseInt(duration);
            if (isNaN(durationNum) || durationNum <= 0) {
              return interaction.editReply({ content: "❌ Invalid duration. Please provide a positive number of minutes.", components: [], flags: MessageFlags.Ephemeral });
            }
            autoDeletDuration = durationNum;
          }
          
          // Note: Auto-delete is ignored for recurring messages since they replace themselves

          // Create schedule entry
          const scheduleId = generateId();
          const scheduleEntry = {
            id: scheduleId,
            messageContent: parsedMessage,
            channelId: channelId,
            scheduledTime: scheduledDate.toISOString(),
            autoDeleteDuration: autoDeletDuration,
            isRecurring: isRecurring,
            recurringInterval: recurringMs,
            recurringDisplay: recurringDisplay,
            lastMessageId: null, // Store ID of last sent message for deletion
            guildId: interaction.guild.id,
            createdBy: interaction.user.id,
            createdAt: new Date().toISOString(),
            status: 'scheduled',
            // Webhook branding options
            useWebhook: false,
            webhookName: null,
            webhookAvatar: null
          };

          // Save to database
          try {
            scheduledMessages.set(scheduleId, scheduleEntry);
            db.saveScheduledMessage(scheduleEntry);
            
            const embed = new EmbedBuilder()
              .setTitle("✅ Message Scheduled Successfully")
              .setDescription(`Your message has been ${scheduleTime ? `scheduled for ${scheduleTime}` : 'scheduled to start immediately'}${isRecurring ? ` and will repeat ${recurringDisplay.toLowerCase()}` : ''}`)
              .setColor("#00FF00")
              .addFields([
                { name: "Channel", value: `<#${channelId}>`, inline: true },
                { name: "Scheduled Time", value: `<t:${Math.floor(scheduledDate.getTime() / 1000)}:F>`, inline: true },
                { name: "Recurring", value: isRecurring ? `Yes (${recurringDisplay})` : "No", inline: true },
                { name: "Auto-delete", value: autoDeletDuration ? `${autoDeletDuration} minutes` : (isRecurring ? "N/A (recurring)" : "No"), inline: true },
                { name: "Message Preview", value: `\`\`\`json\n${messageJson.substring(0, 200)}${messageJson.length > 200 ? '...' : ''}\n\`\`\``, inline: false }
              ]);

            const webhookButton = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`schedule:webhook:${scheduleId}`)
                .setLabel('Configure Webhook')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔗'),
              new ButtonBuilder()
                .setCustomId("schedule:back")
                .setLabel("Back to Dashboard")
                .setStyle(ButtonStyle.Secondary)
            );

            await interaction.editReply({ embeds: [embed], components: [webhookButton], flags: MessageFlags.Ephemeral });
          } catch (error) {
            console.error("Error saving scheduled message:", error);
            await interaction.editReply({ content: "❌ Error saving scheduled message. Please try again.", components: [], flags: MessageFlags.Ephemeral });
          }
        }

        if (modalType === "webhook") {
          const scheduleId = parts[3];
          const schedule = scheduledMessages.get(scheduleId);
          if (!schedule) {
            return interaction.editReply({ content: "❌ Schedule not found.", flags: MessageFlags.Ephemeral });
          }
          
          const useWebhookInput = interaction.fields.getTextInputValue("use_webhook").toLowerCase().trim();
          const webhookName = interaction.fields.getTextInputValue("webhook_name").trim();
          const webhookAvatar = interaction.fields.getTextInputValue("webhook_avatar").trim();
          
          // Validate webhook toggle
          if (useWebhookInput !== "yes" && useWebhookInput !== "no") {
            return interaction.editReply({ content: "❌ Invalid webhook setting. Please enter 'yes' or 'no'.", flags: MessageFlags.Ephemeral });
          }
          
          const useWebhook = useWebhookInput === "yes";
          
          // Validate webhook name (if provided)
          if (webhookName && webhookName.length > 80) {
            return interaction.editReply({ content: "❌ Webhook name too long. Maximum 80 characters.", flags: MessageFlags.Ephemeral });
          }
          
          // Validate webhook avatar URL (if provided)
          if (webhookAvatar && webhookAvatar.length > 0) {
            try {
              new URL(webhookAvatar);
            } catch {
              return interaction.editReply({ content: "❌ Invalid webhook avatar URL. Please provide a valid URL.", flags: MessageFlags.Ephemeral });
            }
          }
          
          // Update schedule with webhook settings
          schedule.useWebhook = useWebhook;
          schedule.webhookName = webhookName || null;
          schedule.webhookAvatar = webhookAvatar || null;
          
          // Save updated schedule
          scheduledMessages.set(scheduleId, schedule);
          db.saveScheduledMessage(schedule);
          
          const embed = new EmbedBuilder()
            .setTitle("✅ Webhook Settings Updated")
            .setDescription("The webhook settings for this scheduled message have been updated.")
            .setColor("#00FF00")
            .addFields([
              { name: "Use Webhook", value: useWebhook ? "Yes" : "No", inline: true },
              { name: "Webhook Name", value: webhookName || "Default", inline: true },
              { name: "Webhook Avatar", value: webhookAvatar ? "Custom URL" : "Default", inline: true }
            ]);
          
          await interaction.editReply({ embeds: [embed], components: [], flags: MessageFlags.Ephemeral });
          return;
        }
      } else if (ctx === "rr" && action === "modal") {
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

      if (ctx === "info" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure information menus.", "#FF0000", "Permission Denied", false);
        }

        if (modalType === "create") {
          const name = interaction.fields.getTextInputValue("name");
          const desc = interaction.fields.getTextInputValue("desc");
          const newInfoMenuId = await db.createInfoMenu(interaction.guild.id, name, desc);
          await sendEphemeralEmbed(interaction, `✅ Information menu "${name}" created successfully!`, "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, newInfoMenuId);
        }

        if (modalType === "add_page") {
          const infoMenuId = parts[3];
          const pageJsonRaw = interaction.fields.getTextInputValue("page_json");

          try {
            let pageData = JSON.parse(pageJsonRaw);
            
            // Auto-detect Discohook format and convert it
            if (pageData.embeds && Array.isArray(pageData.embeds) && pageData.embeds.length > 0) {
              const embed = pageData.embeds[0]; // Use first embed
              
              // Helper functions for validation
              const isValidUrl = (url) => {
                if (!url || typeof url !== 'string' || url.trim() === '') return false;
                try {
                  new URL(url);
                  return true;
                } catch {
                  return false;
                }
              };

              const normalizeColor = (color) => {
                if (!color) return null;
                if (typeof color === 'number') {
                  return `#${color.toString(16).padStart(6, '0')}`;
                }
                if (typeof color === 'string') {
                  if (/^#[0-9A-F]{6}$/i.test(color)) return color;
                  if (/^[0-9A-F]{6}$/i.test(color)) return `#${color}`;
                }
                return null;
              };
              
              // Convert Discohook format to page format with validation
              pageData = {
                id: embed.title ? embed.title.toLowerCase().replace(/[^a-z0-9]/g, '_') : `page_${Date.now()}`,
                name: embed.title || "Imported Page",
                content: {
                  title: embed.title,
                  description: embed.description,
                  color: normalizeColor(embed.color),
                  thumbnail: isValidUrl(embed.thumbnail?.url) ? embed.thumbnail.url : 
                            isValidUrl(embed.thumbnail) ? embed.thumbnail : null,
                  image: isValidUrl(embed.image?.url) ? embed.image.url : 
                         isValidUrl(embed.image) ? embed.image : null,
                  author: embed.author && embed.author.name ? {
                    name: embed.author.name,
                    iconURL: isValidUrl(embed.author.iconURL || embed.author.icon_url) ? 
                            (embed.author.iconURL || embed.author.icon_url) : null
                  } : null,
                  footer: embed.footer && embed.footer.text ? {
                    text: embed.footer.text,
                    iconURL: isValidUrl(embed.footer.iconURL || embed.footer.icon_url) ? 
                            (embed.footer.iconURL || embed.footer.icon_url) : null
                  } : null,
                  fields: Array.isArray(embed.fields) ? embed.fields.filter(field => 
                    field && field.name && field.value
                  ) : null
                }
              };
            }
            
            // Validate required fields
            if (!pageData.id || !pageData.name || !pageData.content) {
              return sendEphemeralEmbed(interaction, "❌ JSON must include 'id', 'name', and 'content' fields.\n\n**Tip:** You can paste Discohook JSON directly and it will be auto-converted!", "#FF0000", "JSON Error", false);
            }

            const pageId = await db.saveInfoMenuPage(infoMenuId, {
              id: pageData.id,
              name: pageData.name,
              content: pageData.content,
              displayIn: pageData.displayIn || ['dropdown', 'button'] // Default to both if not specified
            });
            await sendEphemeralEmbed(interaction, `✅ Page "${pageData.name}" added successfully!`, "#00FF00", "Success", false);
            return showInfoMenuConfiguration(interaction, infoMenuId);
          } catch (error) {
            console.error("Error parsing page JSON:", error);
            return sendEphemeralEmbed(interaction, "❌ Invalid JSON format. Please check your JSON syntax.\n\n**Tip:** You can paste Discohook JSON directly!", "#FF0000", "JSON Error", false);
          }
        }

        if (modalType === "edit_page") {
          const infoMenuId = parts[3];
          const pageId = parts[4];
          const pageJsonRaw = interaction.fields.getTextInputValue("page_json");

          try {
            let pageData = JSON.parse(pageJsonRaw);
            
            // Auto-detect Discohook format and convert it (same as add_page)
            if (pageData.embeds && Array.isArray(pageData.embeds) && pageData.embeds.length > 0) {
              const embed = pageData.embeds[0];
              
              // Helper functions for validation
              const isValidUrl = (url) => {
                if (!url || typeof url !== 'string' || url.trim() === '') return false;
                try {
                  new URL(url);
                  return true;
                } catch {
                  return false;
                }
              };

              const normalizeColor = (color) => {
                if (!color) return null;
                if (typeof color === 'number') {
                  return `#${color.toString(16).padStart(6, '0')}`;
                }
                if (typeof color === 'string') {
                  if (/^#[0-9A-F]{6}$/i.test(color)) return color;
                  if (/^[0-9A-F]{6}$/i.test(color)) return `#${color}`;
                }
                return null;
              };
              
              // Convert Discohook format to page format with validation
              pageData = {
                id: pageId, // Keep the existing page ID
                name: embed.title || "Edited Page",
                content: {
                  title: embed.title,
                  description: embed.description,
                  color: normalizeColor(embed.color),
                  thumbnail: isValidUrl(embed.thumbnail?.url) ? embed.thumbnail.url : 
                            isValidUrl(embed.thumbnail) ? embed.thumbnail : null,
                  image: isValidUrl(embed.image?.url) ? embed.image.url : 
                         isValidUrl(embed.image) ? embed.image : null,
                  author: embed.author && embed.author.name ? {
                    name: embed.author.name,
                    iconURL: isValidUrl(embed.author.iconURL || embed.author.icon_url) ? 
                            (embed.author.iconURL || embed.author.icon_url) : null
                  } : null,
                  footer: embed.footer && embed.footer.text ? {
                    text: embed.footer.text,
                    iconURL: isValidUrl(embed.footer.iconURL || embed.footer.icon_url) ? 
                            (embed.footer.iconURL || embed.footer.icon_url) : null
                  } : null,
                  fields: Array.isArray(embed.fields) ? embed.fields.filter(field => 
                    field && field.name && field.value
                  ) : null
                }
              };
            }
            
            // Validate required fields
            if (!pageData.id || !pageData.name || !pageData.content) {
              return interaction.reply({
                content: "❌ JSON must include 'id', 'name', and 'content' fields.\n\n**Tip:** You can paste Discohook JSON directly and it will be auto-converted!",
                flags: MessageFlags.Ephemeral
              });
            }

            // Ensure the page ID matches
            pageData.id = pageId;

            await db.saveInfoMenuPage(infoMenuId, pageData);
            
            // Reply with success message and a button to go back to page management
            const backButton = new ButtonBuilder()
              .setCustomId(`info:manage_pages:${infoMenuId}`)
              .setLabel("Back to Page Management")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("⬅️");
            
            const row = new ActionRowBuilder().addComponents(backButton);
            
            return interaction.reply({
              content: `✅ Page "${pageData.name}" updated successfully!`,
              components: [row],
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error("Error parsing/updating page JSON:", error);
            return interaction.reply({
              content: "❌ Invalid JSON format. Please check your JSON syntax.\n\n**Tip:** You can paste Discohook JSON directly!",
              flags: MessageFlags.Ephemeral
            });
          }
        }

        if (modalType === "reorder_pages") {
          const infoMenuId = parts[3];
          const newOrderRaw = interaction.fields.getTextInputValue("new_order_numbers");

          try {
            const menu = db.getInfoMenu(infoMenuId);
            if (!menu) {
              return interaction.reply({
                content: "❌ Information menu not found.",
                flags: MessageFlags.Ephemeral
              });
            }

            const pages = db.getInfoMenuPages(infoMenuId);
            if (!pages || pages.length < 2) {
              return interaction.reply({
                content: "❌ You need at least 2 pages to reorder them.",
                flags: MessageFlags.Ephemeral
              });
            }

            // Parse the new order
            const orderNumbers = newOrderRaw.split(',').map(num => parseInt(num.trim()));
            
            // Validate the order numbers
            if (orderNumbers.length !== pages.length) {
              return interaction.reply({
                content: `❌ You must provide exactly ${pages.length} numbers (one for each page).`,
                flags: MessageFlags.Ephemeral
              });
            }

            // Check that all numbers are valid and within range
            const validNumbers = new Set();
            for (const num of orderNumbers) {
              if (isNaN(num) || num < 1 || num > pages.length) {
                return interaction.reply({
                  content: `❌ All numbers must be between 1 and ${pages.length}.`,
                  flags: MessageFlags.Ephemeral
                });
              }
              if (validNumbers.has(num)) {
                return interaction.reply({
                  content: `❌ Each number can only be used once. Duplicate found: ${num}`,
                  flags: MessageFlags.Ephemeral
                });
              }
              validNumbers.add(num);
            }

            // Reorder the pages
            const reorderedPages = orderNumbers.map(num => pages[num - 1]);
            
            // Update the menu with the new page order
            await db.updateInfoMenu(infoMenuId, { pages: reorderedPages });
            
            // Reply with success message and a button to go back to page management
            const backButton = new ButtonBuilder()
              .setCustomId(`info:manage_pages:${infoMenuId}`)
              .setLabel("Back to Page Management")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("⬅️");
            
            const row = new ActionRowBuilder().addComponents(backButton);
            
            return interaction.reply({
              content: `✅ Pages reordered successfully!`,
              components: [row],
              flags: MessageFlags.Ephemeral
            });
          } catch (error) {
            console.error("Error reordering pages:", error);
            return interaction.reply({
              content: "❌ Invalid order format. Please use numbers separated by commas (e.g., 1, 3, 2).",
              flags: MessageFlags.Ephemeral
            });
          }
        }

        if (modalType === "customize_embed") {
          const infoMenuId = parts[3];
          const embedColor = interaction.fields.getTextInputValue("embed_color") || null;
          const embedThumbnail = interaction.fields.getTextInputValue("thumbnail_url") || null;
          const embedImage = interaction.fields.getTextInputValue("image_url") || null;
          const embedAuthorName = interaction.fields.getTextInputValue("author_name") || null;
          const embedAuthorIconURL = interaction.fields.getTextInputValue("author_icon_url") || null;

          if (embedColor && !/^#[0-9A-F]{6}$/i.test(embedColor)) {
            return sendEphemeralEmbed(interaction, "❌ Invalid color format. Use hex format like #5865F2", "#FF0000", "Invalid Color", false);
          }

          await db.updateInfoMenu(infoMenuId, {
            embedColor,
            embedThumbnail,
            embedImage,
            embedAuthorName,
            embedAuthorIconURL
          });
          await sendEphemeralEmbed(interaction, "✅ Embed customization saved!", "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (modalType === "customize_footer") {
          const infoMenuId = parts[3];
          const footerText = interaction.fields.getTextInputValue("footer_text") || null;
          const footerIconURL = interaction.fields.getTextInputValue("footer_icon_url") || null;

          await db.updateInfoMenu(infoMenuId, {
            embedFooterText: footerText,
            embedFooterIconURL: footerIconURL
          });
          await sendEphemeralEmbed(interaction, "✅ Footer customization saved!", "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (modalType === "save_as_template") {
          const infoMenuId = parts[3];
          const templateName = interaction.fields.getTextInputValue("template_name");
          const templateDescription = interaction.fields.getTextInputValue("template_description") || "";

          if (!templateName || templateName.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Template name is required.", "#FF0000", "Input Error", false);
          }

          await db.updateInfoMenu(infoMenuId, {
            isTemplate: true,
            templateName: templateName.trim(),
            templateDescription: templateDescription.trim()
          });
          await sendEphemeralEmbed(interaction, `✅ Information menu saved as template: "${templateName}"`, "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (modalType === "create_from_template") {
          const templateId = parts[3];
          const newName = interaction.fields.getTextInputValue("new_name");
          const newDesc = interaction.fields.getTextInputValue("new_desc");

          if (!newName || newName.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Menu name is required.", "#FF0000", "Input Error", false);
          }

          if (!newDesc || newDesc.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ Menu description is required.", "#FF0000", "Input Error", false);
          }

          try {
            const newInfoMenuId = await db.createInfoMenuFromTemplate(templateId, interaction.guild.id, newName.trim(), newDesc.trim());
            const template = db.getInfoMenu(templateId);
            await sendEphemeralEmbed(interaction, `✅ Information menu created from template "${template.templateName}"! New menu: "${newName}"`, "#00FF00", "Success", false);
            return showInfoMenuConfiguration(interaction, newInfoMenuId);
          } catch (error) {
            console.error("Error creating info menu from template:", error);
            return sendEphemeralEmbed(interaction, "❌ Failed to create menu from template. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "add_page_custom") {
          const infoMenuId = parts[3];
          const pageName = interaction.fields.getTextInputValue("page_name");
          const pageTitle = interaction.fields.getTextInputValue("page_title");
          const pageDescription = interaction.fields.getTextInputValue("page_description");
          const pageColor = interaction.fields.getTextInputValue("page_color") || "#5865F2";
          const pageEmoji = interaction.fields.getTextInputValue("page_emoji") || "";

          // Validate color format
          let validColor = pageColor;
          if (pageColor && !pageColor.startsWith('#')) {
            validColor = '#' + pageColor.replace('#', '');
          }
          if (!/^#[0-9A-F]{6}$/i.test(validColor)) {
            validColor = "#5865F2"; // Default color if invalid
          }

          // Create the new page
          const pageId = `page_${Date.now()}`;
          const newPage = {
            id: pageId,
            name: pageName.trim(),
            content: {
              title: pageTitle.trim(),
              description: pageDescription.trim(),
              color: validColor
            },
            displayIn: ['dropdown', 'button'], // Default to both
            emoji: pageEmoji.trim() || null,
            category: "Custom",
            order: Date.now(),
            createdAt: new Date().toISOString()
          };

          try {
            await db.saveInfoMenuPage(infoMenuId, newPage);
            await sendEphemeralEmbed(interaction, `✅ Page "${pageName}" created successfully!`, "#00FF00", "Success", false);
            return showInfoMenuConfiguration(interaction, infoMenuId);
          } catch (error) {
            console.error("Error creating custom page:", error);
            return sendEphemeralEmbed(interaction, `❌ Failed to create page: ${error.message}`, "#FF0000", "Error", false);
          }
        }

        if (modalType === "create_from_json") {
          const jsonString = interaction.fields.getTextInputValue("raw_json_input");

          let parsedJson;
          try {
            parsedJson = JSON.parse(jsonString);
          } catch (e) {
            return sendEphemeralEmbed(interaction, "❌ Invalid JSON format. Please ensure it's valid JSON.", "#FF0000", "JSON Error", false);
          }

          // Auto-detect Discohook format and convert it
          if (parsedJson.embeds && Array.isArray(parsedJson.embeds) && parsedJson.embeds.length > 0) {
            const embed = parsedJson.embeds[0]; // Use first embed
            
            // Helper functions for validation
            const isValidUrl = (url) => {
              if (!url || typeof url !== 'string' || url.trim() === '') return false;
              try {
                new URL(url);
                return true;
              } catch {
                return false;
              }
            };

            const normalizeColor = (color) => {
              if (!color) return "#5865F2";
              if (typeof color === 'number') {
                return `#${color.toString(16).padStart(6, '0')}`;
              }
              if (typeof color === 'string') {
                if (/^#[0-9A-F]{6}$/i.test(color)) return color;
                if (/^[0-9A-F]{6}$/i.test(color)) return `#${color}`;
              }
              return "#5865F2";
            };
            
            // Convert Discohook format to our format with validation
            const convertedJson = {
              name: embed.title || "Imported Menu",
              desc: embed.description ? 
                (embed.description.length > 100 ? embed.description.substring(0, 97) + "..." : embed.description) 
                : "Imported from Discohook",
              embedColor: normalizeColor(embed.color),
              pages: [{
                id: "main",
                name: embed.title || "Main Page",
                content: {
                  title: embed.title,
                  description: embed.description,
                  color: normalizeColor(embed.color),
                  thumbnail: isValidUrl(embed.thumbnail?.url) ? embed.thumbnail.url : 
                            isValidUrl(embed.thumbnail) ? embed.thumbnail : null,
                  image: isValidUrl(embed.image?.url) ? embed.image.url : 
                         isValidUrl(embed.image) ? embed.image : null,
                  author: embed.author && embed.author.name ? {
                    name: embed.author.name,
                    iconURL: isValidUrl(embed.author.iconURL || embed.author.icon_url) ? 
                            (embed.author.iconURL || embed.author.icon_url) : null
                  } : null,
                  footer: embed.footer && embed.footer.text ? {
                    text: embed.footer.text,
                    iconURL: isValidUrl(embed.footer.iconURL || embed.footer.icon_url) ? 
                            (embed.footer.iconURL || embed.footer.icon_url) : null
                  } : null,
                  fields: Array.isArray(embed.fields) ? embed.fields.filter(field => 
                    field && field.name && field.value
                  ) : null
                }
              }]
            };
            
            parsedJson = convertedJson;
          }

          // Extract required fields from JSON
          const menuName = parsedJson.name;
          const menuDesc = parsedJson.desc || parsedJson.description;

          if (!menuName || typeof menuName !== 'string' || menuName.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ JSON must include a 'name' field with the menu name.", "#FF0000", "Missing Name", false);
          }

          if (!menuDesc || typeof menuDesc !== 'string' || menuDesc.trim().length === 0) {
            return sendEphemeralEmbed(interaction, "❌ JSON must include a 'desc' or 'description' field with the menu description.", "#FF0000", "Missing Description", false);
          }

          try {
            const newInfoMenuId = await db.createInfoMenu(interaction.guild.id, menuName.trim(), menuDesc.trim());
            
            // Apply JSON configuration
            const updateData = {};
            if (parsedJson.embedColor) updateData.embedColor = parsedJson.embedColor;
            if (parsedJson.embedThumbnail) updateData.embedThumbnail = parsedJson.embedThumbnail;
            if (parsedJson.embedImage) updateData.embedImage = parsedJson.embedImage;
            if (parsedJson.embedAuthorName) updateData.embedAuthorName = parsedJson.embedAuthorName;
            if (parsedJson.embedAuthorIconURL) updateData.embedAuthorIconURL = parsedJson.embedAuthorIconURL;
            if (parsedJson.embedFooterText) updateData.embedFooterText = parsedJson.embedFooterText;
            if (parsedJson.embedFooterIconURL) updateData.embedFooterIconURL = parsedJson.embedFooterIconURL;
            if (parsedJson.selectionType) updateData.selectionType = parsedJson.selectionType;
            if (parsedJson.useWebhook !== undefined) updateData.useWebhook = parsedJson.useWebhook;
            if (parsedJson.webhookName) updateData.webhookName = parsedJson.webhookName;
            if (parsedJson.webhookAvatar) updateData.webhookAvatar = parsedJson.webhookAvatar;
            
            await db.updateInfoMenu(newInfoMenuId, updateData);

            // Add pages if provided
            if (parsedJson.pages && Array.isArray(parsedJson.pages)) {
              for (const page of parsedJson.pages) {
                if (page.name && page.content) {
                  await db.saveInfoMenuPage(newInfoMenuId, {
                    name: page.name,
                    content: page.content
                  });
                }
              }
            }

            await sendEphemeralEmbed(interaction, `✅ Information menu "${menuName}" created successfully from JSON!`, "#00FF00", "Success", false);
            return showInfoMenuConfiguration(interaction, newInfoMenuId);
          } catch (error) {
            console.error("Error creating info menu from JSON:", error);
            return sendEphemeralEmbed(interaction, "❌ Failed to create menu from JSON. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "publish_channel") {
          const infoMenuId = parts[3];
          const channelInput = interaction.fields.getTextInputValue("channel_id").trim();
          
          let channel;
          if (channelInput.startsWith('#')) {
            // Handle #channel format
            const channelName = channelInput.slice(1);
            channel = interaction.guild.channels.cache.find(ch => ch.name === channelName && ch.isTextBased());
          } else {
            // Handle channel ID format
            channel = interaction.guild.channels.cache.get(channelInput);
          }

          if (!channel || !channel.isTextBased()) {
            return sendEphemeralEmbed(interaction, "❌ Channel not found or is not a text channel.", "#FF0000", "Error", false);
          }

          // Check permissions
          if (!channel.permissionsFor(interaction.guild.members.me).has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            return sendEphemeralEmbed(interaction, "❌ I don't have permission to send messages in that channel.", "#FF0000", "Error", false);
          }

          try {
            const menu = db.getInfoMenu(infoMenuId);
            const pages = db.getInfoMenuPages(infoMenuId);

            // Create the main embed
            const embed = new EmbedBuilder()
              .setTitle(menu.name)
              .setDescription(menu.desc)
              .setColor(menu.embedColor || "#5865F2");

            if (menu.embedThumbnail) embed.setThumbnail(menu.embedThumbnail);
            if (menu.embedImage) embed.setImage(menu.embedImage);
            
            if (menu.embedAuthorName) {
              embed.setAuthor({
                name: menu.embedAuthorName,
                iconURL: menu.embedAuthorIconURL
              });
            }

            if (menu.embedFooterText) {
              embed.setFooter({
                text: menu.embedFooterText,
                iconURL: menu.embedFooterIconURL
              });
            }

            // Create interaction components
            const components = [];
            const selectionTypes = Array.isArray(menu.selectionType) ? menu.selectionType : 
                                  (menu.selectionType ? [menu.selectionType] : []);

            if (selectionTypes.includes("dropdown")) {
              const pageOptions = pages.slice(0, 25).map(page => ({
                label: page.name.substring(0, 100),
                value: page.id,
                description: page.dropdownDescription || (page.content.description ? page.content.description.substring(0, 100) : undefined),
                emoji: page.emoji || '📄'
              }));

              const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`info-menu-select:${infoMenuId}`)
                .setPlaceholder(menu.dropdownPlaceholder || "📚 Select a page to view...")
                .addOptions(pageOptions);

              components.push(new ActionRowBuilder().addComponents(selectMenu));
            }
            
            if (selectionTypes.includes("button")) {
              // Create buttons for pages
              const maxButtons = Math.min(pages.length, 25);
              let currentRow = new ActionRowBuilder();
              let buttonsInRow = 0;
              let rowCount = 0;

              // If dropdown is already taking a row, we have 4 rows left for buttons
              const maxRows = selectionTypes.includes("dropdown") ? 4 : 5;

              for (let i = 0; i < maxButtons; i++) {
                const page = pages[i];
                const buttonStyle = page.buttonColor || 'Secondary'; // Use buttonColor instead of buttonStyle
                const button = new ButtonBuilder()
                  .setCustomId(`info-page:${infoMenuId}:${page.id}`)
                  .setLabel(page.name.substring(0, 80))
                  .setStyle(ButtonStyle[buttonStyle]);

                // Add emoji if page has one
                if (page.emoji) {
                  button.setEmoji(page.emoji);
                }

                currentRow.addComponents(button);
                buttonsInRow++;

                if (buttonsInRow === 5 || i === maxButtons - 1) {
                  components.push(currentRow);
                  currentRow = new ActionRowBuilder();
                  buttonsInRow = 0;
                  rowCount++;
                  
                  if (rowCount >= maxRows) break; // Discord limit
                }
              }
            }

            // Send the message
            const message = await channel.send({
              embeds: [embed],
              components: components
            });

            // Save the message info to the menu
            await db.updateInfoMenu(infoMenuId, {
              channelId: channel.id,
              messageId: message.id
            });

            await sendEphemeralEmbed(interaction, `✅ Information menu "${menu.name}" published successfully in ${channel}!`, "#00FF00", "Success", false);
            return showInfoMenuConfiguration(interaction, infoMenuId);
          } catch (error) {
            console.error("Error publishing info menu:", error);
            return sendEphemeralEmbed(interaction, `❌ Failed to publish menu: ${error.message}`, "#FF0000", "Error", false);
          }
        }

        if (modalType === "set_button_color") {
          const infoMenuId = parts[3];
          const pageId = parts[4];
          const buttonColor = interaction.fields.getTextInputValue("button_color").trim();

          // Validate button color
          const validColors = ['Primary', 'Secondary', 'Success', 'Danger'];
          if (!validColors.includes(buttonColor)) {
            return sendEphemeralEmbed(interaction, `❌ Invalid button color. Valid options: ${validColors.join(', ')}`, "#FF0000", "Invalid Color", false);
          }

          const page = db.getInfoMenuPage(infoMenuId, pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          // Update the page with new button color
          const updatedPage = { ...page, buttonColor };
          await db.updateInfoMenuPage(infoMenuId, pageId, { buttonColor });

          await sendEphemeralEmbed(interaction, `✅ Button color for "${page.name}" set to ${buttonColor}!`, "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (modalType === "set_page_description") {
          const infoMenuId = parts[3];
          const pageId = parts[4];
          const description = interaction.fields.getTextInputValue("page_description").trim();

          const page = db.getInfoMenuPage(infoMenuId, pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          // Update the page with new description (can be empty to remove)
          const updatedPage = { 
            ...page, 
            dropdownDescription: description || null 
          };
          await db.updateInfoMenuPage(infoMenuId, pageId, { dropdownDescription: description || null });

          const message = description 
            ? `✅ Description for "${page.name}" updated!`
            : `✅ Description for "${page.name}" removed!`;
            
          await sendEphemeralEmbed(interaction, message, "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (modalType === "set_page_emoji") {
          const infoMenuId = parts[3];
          const pageId = parts[4];
          const emoji = interaction.fields.getTextInputValue("page_emoji").trim();

          const page = db.getInfoMenuPage(infoMenuId, pageId);
          if (!page) {
            return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
          }

          // Update the page with new emoji (can be empty to remove)
          await db.updateInfoMenuPage(infoMenuId, pageId, { emoji: emoji || null });

          const message = emoji 
            ? `✅ Emoji for "${page.name}" set to ${emoji}!`
            : `✅ Emoji for "${page.name}" removed!`;
            
          await sendEphemeralEmbed(interaction, message, "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }

        if (modalType === "customize_dropdown_text") {
          const infoMenuId = parts[3];
          const dropdownPlaceholder = interaction.fields.getTextInputValue("dropdown_placeholder").trim();

          const menu = db.getInfoMenu(infoMenuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
          }

          // Update the menu with new dropdown placeholder
          await db.updateInfoMenu(infoMenuId, { 
            dropdownPlaceholder: dropdownPlaceholder || "📚 Select a page to view..." 
          });

          await sendEphemeralEmbed(interaction, `✅ Dropdown placeholder text updated!`, "#00FF00", "Success", false);
          return showInfoMenuConfiguration(interaction, infoMenuId);
        }
      }

      if (ctx === "hybrid" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure hybrid menus.", "#FF0000", "Permission Denied", false);
        }

        if (modalType === "create") {
          try {
            console.log(`[Hybrid Menu] Starting creation process for guild ${interaction.guild.id}`);
            const name = interaction.fields.getTextInputValue("name");
            const desc = interaction.fields.getTextInputValue("desc");
            console.log(`[Hybrid Menu] Creating menu with name: "${name}"`);
            
            const newHybridMenuId = await db.createHybridMenu(interaction.guild.id, name, desc);
            console.log(`[Hybrid Menu] Successfully created menu with ID: ${newHybridMenuId}`);
            
            await sendEphemeralEmbed(interaction, `✅ Hybrid menu "${name}" created successfully!`, "#00FF00", "Success", false);
            return showHybridMenuConfiguration(interaction, newHybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Menu] Error creating hybrid menu:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to create hybrid menu. Please check the logs for details.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "create_from_json") {
          try {
            console.log(`[Hybrid Menu] Starting JSON creation process for guild ${interaction.guild.id}`);
            const jsonData = interaction.fields.getTextInputValue("json_data");
            console.log(`[Hybrid Menu] Processing JSON data`);
            
            // Parse and validate JSON
            let embedData;
            try {
              embedData = JSON.parse(jsonData);
            } catch (parseError) {
              console.error(`[Hybrid Menu] JSON parse error:`, parseError);
              return sendEphemeralEmbed(interaction, "❌ Invalid JSON format. Please check your JSON and try again.", "#FF0000", "JSON Error", false);
            }
            
            // Extract title and description from JSON
            const title = embedData.title || "Hybrid Menu";
            const description = embedData.description || "A new hybrid menu";
            
            console.log(`[Hybrid Menu] Creating menu from JSON with title: "${title}"`);
            
            // Create the hybrid menu
            const newHybridMenuId = await db.createHybridMenu(interaction.guild.id, title, description);
            console.log(`[Hybrid Menu] Successfully created menu with ID: ${newHybridMenuId}`);
            
            // Update the menu with the full JSON data
            await db.updateHybridMenu(newHybridMenuId, { 
              embedData: embedData,
              jsonImported: true
            });
            
            await sendEphemeralEmbed(interaction, `✅ Hybrid menu "${title}" created successfully from JSON!`, "#00FF00", "Success", false);
            return showHybridMenuConfiguration(interaction, newHybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Menu] Error creating hybrid menu from JSON:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to create hybrid menu from JSON. Please check the logs for details.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "add_info_page") {
          try {
            const hybridMenuId = parts[3];
            const pageName = interaction.fields.getTextInputValue("page_name");
            const pageContent = interaction.fields.getTextInputValue("page_content");
            
            console.log(`[Hybrid Menu] Adding info page "${pageName}" to menu ${hybridMenuId}`);
            
            // Add the page to the hybrid menu
            const pageId = generateId();
            const newPage = {
              id: pageId,
              name: pageName,
              content: pageContent,
              createdAt: new Date().toISOString()
            };
            
            // Get current menu and add the page
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }
            
            const currentPages = menu.pages || [];
            currentPages.push(newPage);
            
            await db.updateHybridMenu(hybridMenuId, { pages: currentPages });
            
            await sendEphemeralEmbed(interaction, `✅ Information page "${pageName}" added successfully!`, "#00FF00", "Success", false);
            return showHybridInfoConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Menu] Error adding info page:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to add information page. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "add_info_page_json") {
          try {
            const hybridMenuId = parts[3];
            const jsonData = interaction.fields.getTextInputValue("json_data");
            
            console.log(`[Hybrid Menu] Adding info page from JSON to menu ${hybridMenuId}`);
            
            // Parse and validate JSON
            let embedData;
            try {
              embedData = JSON.parse(jsonData);
            } catch (parseError) {
              console.error(`[Hybrid Menu] JSON parse error:`, parseError);
              return sendEphemeralEmbed(interaction, "❌ Invalid JSON format. Please check your JSON and try again.", "#FF0000", "JSON Error", false);
            }
            
            // Extract title and description from JSON
            const pageName = embedData.title || `Page ${Date.now()}`;
            const pageContent = embedData.description || "No content provided";
            
            // Add the page to the hybrid menu
            const pageId = generateId();
            const newPage = {
              id: pageId,
              name: pageName,
              content: pageContent,
              embedData: embedData, // Store the full JSON data
              createdAt: new Date().toISOString()
            };
            
            // Get current menu and add the page
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }
            
            const currentPages = menu.pages || [];
            currentPages.push(newPage);
            
            await db.updateHybridMenu(hybridMenuId, { pages: currentPages });
            
            await sendEphemeralEmbed(interaction, `✅ Information page "${pageName}" added successfully from JSON!`, "#00FF00", "Success", false);
            return showHybridInfoConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Menu] Error adding info page from JSON:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to add information page from JSON. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "add_info_page_with_type") {
          try {
            const hybridMenuId = parts[3];
            const displayType = parts[4];
            const title = interaction.fields.getTextInputValue("title");
            const description = interaction.fields.getTextInputValue("description");
            const emoji = interaction.fields.getTextInputValue("emoji") || null;
            
            console.log(`[Hybrid Menu] Adding info page "${title}" with display type "${displayType}" to menu ${hybridMenuId}`);
            
            // Add the page to the hybrid menu
            const pageId = generateId();
            const newPage = {
              id: pageId,
              name: title,
              content: description,
              emoji: emoji,
              displayType: displayType, // Store the display type on the page
              createdAt: new Date().toISOString()
            };
            
            // Get current menu and add the page
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }
            
            const currentPages = menu.pages || [];
            currentPages.push(newPage);
            
            await db.updateHybridMenu(hybridMenuId, { pages: currentPages });
            
            await sendEphemeralEmbed(interaction, `✅ Information page "${title}" added successfully as ${displayType}!`, "#00FF00", "Success", false);
            return showHybridInfoConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Menu] Error adding info page with type:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to add information page. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "edit_info_page") {
          try {
            const hybridMenuId = parts[3];
            const pageId = parts[4];
            const pageName = interaction.fields.getTextInputValue("page_name");
            const pageContent = interaction.fields.getTextInputValue("page_content");
            
            console.log(`[Hybrid Menu] Editing info page ${pageId} in menu ${hybridMenuId}`);
            
            // Get current menu and update the page
            const menu = db.getHybridMenu(hybridMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
            }
            
            const pages = menu.pages || [];
            const pageIndex = pages.findIndex(p => p.id === pageId);
            
            if (pageIndex === -1) {
              return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
            }
            
            // Update the page
            pages[pageIndex] = {
              ...pages[pageIndex],
              name: pageName,
              content: pageContent,
              updatedAt: new Date().toISOString()
            };
            
            await db.updateHybridMenu(hybridMenuId, { pages });
            
            await sendEphemeralEmbed(interaction, `✅ Information page "${pageName}" updated successfully!`, "#00FF00", "Success", false);
            return showHybridInfoConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Menu] Error editing info page:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to edit information page. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "customize_dropdown_text") {
          try {
            const hybridMenuId = parts[3];
            
            console.log(`[Hybrid Menu] Customizing dropdown text for menu ${hybridMenuId}`);
            
            const infoDropdownPlaceholder = interaction.fields.getTextInputValue("info_dropdown_placeholder");
            const roleDropdownPlaceholder = interaction.fields.getTextInputValue("role_dropdown_placeholder");
            const infoDropdownMaxText = interaction.fields.getTextInputValue("info_dropdown_max_text");
            const roleDropdownMaxText = interaction.fields.getTextInputValue("role_dropdown_max_text");
            
            // Update the hybrid menu with the new dropdown text settings
            await db.updateHybridMenu(hybridMenuId, {
              infoDropdownPlaceholder: infoDropdownPlaceholder || "📚 Select a page to view...",
              roleDropdownPlaceholder: roleDropdownPlaceholder || "🎭 Select roles to toggle...",
              infoDropdownMaxText: infoDropdownMaxText || "You can only select one page at a time",
              roleDropdownMaxText: roleDropdownMaxText || "Select multiple roles"
            });
            
            await sendEphemeralEmbed(interaction, `✅ Dropdown text customized successfully!`, "#00FF00", "Success", false);
            return showHybridMenuConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Menu] Error customizing dropdown text:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to customize dropdown text. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "webhook_branding") {
          try {
            const hybridMenuId = parts[3];
            
            console.log(`[Hybrid Menu] Setting webhook branding for menu ${hybridMenuId}`);
            
            // Use the working pattern from reaction role system
            const name = interaction.fields.getTextInputValue("name");
            const avatar = interaction.fields.getTextInputValue("avatar");
            
            // Update the hybrid menu with the new webhook branding settings
            await db.updateHybridMenu(hybridMenuId, {
              webhookName: name || null,
              webhookAvatar: avatar || null
            });
            
            await sendEphemeralEmbed(interaction, `✅ Webhook branding configured successfully!`, "#00FF00", "Success", false);
            return showHybridMenuConfiguration(interaction, hybridMenuId);
          } catch (error) {
            console.error(`[Hybrid Menu] Error setting webhook branding:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to configure webhook branding. Please try again.", "#FF0000", "Error", false);
          }
        }

        if (modalType === "configure_member_counts") {
          try {
            const showInDropdowns = interaction.fields.getTextInputValue("show_in_dropdowns").toLowerCase().trim();
            const showInButtons = interaction.fields.getTextInputValue("show_in_buttons").toLowerCase().trim();
            
            const dropdownsEnabled = ['yes', 'y', 'true', '1', 'on'].includes(showInDropdowns);
            const buttonsEnabled = ['yes', 'y', 'true', '1', 'on'].includes(showInButtons);
            
            if (ctx === "hybrid") {
              const hybridMenuId = parts[3];
              
              // Update hybrid menu settings
              await db.updateHybridMenu(hybridMenuId, {
                showMemberCounts: dropdownsEnabled || buttonsEnabled,
                memberCountOptions: {
                  showInDropdowns: dropdownsEnabled,
                  showInButtons: buttonsEnabled
                }
              });
              
              // Force update the published message if it exists
              const menu = db.getHybridMenu(hybridMenuId);
              if (menu && menu.channelId && menu.messageId) {
                const guild = interaction.guild;
                const mockInteraction = { guild: guild, user: client.user, member: guild.members.me };
                await updatePublishedHybridMenuComponents(mockInteraction, menu, hybridMenuId, true);
              }
              
              await sendEphemeralEmbed(interaction, `✅ Member count display configured!\nDropdowns: ${dropdownsEnabled ? 'Enabled' : 'Disabled'}\nButtons: ${buttonsEnabled ? 'Enabled' : 'Disabled'}`, "#00FF00", "Success", false);
              return showHybridMenuConfiguration(interaction, hybridMenuId);
              
            } else if (ctx === "rr") {
              const menuId = parts[3];
              
              // Update reaction role menu settings
              await db.updateMenu(menuId, {
                showMemberCounts: dropdownsEnabled || buttonsEnabled,
                memberCountOptions: {
                  showInDropdowns: dropdownsEnabled,
                  showInButtons: buttonsEnabled
                }
              });
              
              // Force update the published message if it exists
              const menu = db.getMenu(menuId);
              if (menu && menu.channelId && menu.messageId) {
                const guild = interaction.guild;
                const mockInteraction = { guild: guild, user: client.user, member: guild.members.me };
                await updatePublishedMessageComponents(mockInteraction, menu, menuId, true);
              }
              
              await sendEphemeralEmbed(interaction, `✅ Member count display configured!\nDropdowns: ${dropdownsEnabled ? 'Enabled' : 'Disabled'}\nButtons: ${buttonsEnabled ? 'Enabled' : 'Disabled'}`, "#00FF00", "Success", false);
              return showReactionRoleMenuConfiguration(interaction, menuId);
            }
          } catch (error) {
            console.error(`[${ctx}] Error configuring member counts:`, error);
            return sendEphemeralEmbed(interaction, "❌ Failed to configure member count settings. Please try again.", "#FF0000", "Error", false);
          }
        }
      }
    }

    // Handle hybrid menu interactions (published hybrid menus)
    if ((interaction.isStringSelectMenu() && interaction.customId.startsWith("hybrid-info-select:")) ||
        (interaction.isStringSelectMenu() && interaction.customId.startsWith("hybrid-role-select:")) ||
        (interaction.isButton() && interaction.customId.startsWith("hybrid-info-page:")) ||
        (interaction.isButton() && interaction.customId.startsWith("hybrid-role-button:"))) {
        
        return handleHybridMenuInteraction(interaction);
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

    // Track menu usage and performance
    if (interaction.customId?.includes("info-page:")) {
      const menuId = interaction.customId.split(":")[1];
      trackMenuUsage(menuId, 'info');
    }
    
    // Track page views
    if (interaction.customId?.includes("info-page:")) {
      const pageId = interaction.customId.split(":")[2];
      if (pageId) trackPageView(pageId);
    }
    
    // Track performance at end of interaction
    try {
      trackInteractionPerformance(interaction, interactionStartTime, interactionSuccess);
    } catch (perfError) {
      console.error("Error tracking performance:", perfError);
    }
});

async function handleRoleInteraction(interaction) {
    // Deferring is now handled at the main interaction level
    // Dropdown interactions use deferUpdate, button interactions use deferReply

    try {
        // Check rate limiting
        if (isOnRoleInteractionCooldown(interaction.user.id)) {
            const timeLeft = Math.ceil((ROLE_INTERACTION_COOLDOWN - (Date.now() - roleInteractionCooldowns.get(interaction.user.id))) / 1000);
            if (interaction.isStringSelectMenu()) {
                // For dropdown interactions, send a follow-up message
                return interaction.followUp({ content: `⏰ Please wait ${timeLeft} seconds before using role interactions again.`, ephemeral: true });
            } else {
                return sendEphemeralEmbed(interaction, `⏰ Please wait ${timeLeft} seconds before using role interactions again.`, "#FFAA00", "Rate Limited");
            }
        }

        const parts = interaction.customId.split(":");
        const menuId = parts[1];
        
        console.log(`[DEBUG] Extracted menuId: "${menuId}"`);
        
        if (!menuId || menuId === 'undefined') {
            console.error(`[Error] Invalid menuId found in customId: ${interaction.customId}`);
            if (interaction.isStringSelectMenu()) {
                return interaction.followUp({ content: "❌ This reaction role menu has an invalid configuration. Please contact an administrator.", ephemeral: true });
            } else {
                return sendEphemeralEmbed(interaction, "❌ This reaction role menu has an invalid configuration. Please contact an administrator.", "#FF0000", "Error");
            }
        }
        
        const menu = db.getMenu(menuId);
        
        if (!menu) {
            console.error(`[Error] Attempted to access non-existent menu with ID: ${menuId}. CustomId: ${interaction.customId}`);
            if (interaction.isStringSelectMenu()) {
                return interaction.followUp({ content: "❌ This reaction role menu is no longer valid. It might have been deleted or corrupted.", ephemeral: true });
            } else {
                return sendEphemeralEmbed(interaction, "❌ This reaction role menu is no longer valid. It might have been deleted or corrupted.", "#FF0000", "Error");
            }
        }

        // Set cooldown
        setRoleInteractionCooldown(interaction.user.id);

        // Validate guild and member
        if (!interaction.guild || !interaction.member) {
            console.error(`[Error] Invalid guild or member for menu ${menuId}`);
            if (interaction.isStringSelectMenu()) {
                return interaction.followUp({ content: "❌ Unable to process role interaction. Please try again.", ephemeral: true });
            } else {
                return sendEphemeralEmbed(interaction, "❌ Unable to process role interaction. Please try again.", "#FF0000", "Error");
            }
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            console.error(`[Error] Could not fetch member ${interaction.user.id} for menu ${menuId}`);
            if (interaction.isStringSelectMenu()) {
                return interaction.followUp({ content: "❌ Unable to fetch your member information. Please try again.", ephemeral: true });
            } else {
                return sendEphemeralEmbed(interaction, "❌ Unable to fetch your member information. Please try again.", "#FF0000", "Error");
            }
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
                if (interaction.isStringSelectMenu()) {
                    return interaction.followUp({ content: "❌ None of the selected roles exist anymore. Please contact an administrator.", ephemeral: true });
                } else {
                    return sendEphemeralEmbed(interaction, "❌ None of the selected roles exist anymore. Please contact an administrator.", "#FF0000", "Error");
                }
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
            if (interaction.isStringSelectMenu()) {
                return interaction.followUp({ content: "❌ Unexpected interaction type. Please try again.", ephemeral: true });
            } else {
                return sendEphemeralEmbed(interaction, "❌ Unexpected interaction type. Please try again.", "#FF0000", "Error");
            }
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
            if (interaction.isStringSelectMenu()) {
                return interaction.followUp({ content: menu.limitExceededMessage || `❌ ${regionalViolations.join("\n")}`, ephemeral: true });
            } else {
                await sendEphemeralEmbed(interaction, menu.limitExceededMessage || `❌ ${regionalViolations.join("\n")}`, "#FF0000", "Limit Exceeded");
            }
            return;
        }

        // Check max roles limit
        if (menu.maxRolesLimit !== null && menu.maxRolesLimit > 0) {
            if (newMenuRoles.length > menu.maxRolesLimit) {
                if (interaction.isStringSelectMenu()) {
                    return interaction.followUp({ content: menu.limitExceededMessage || `❌ You can only have a maximum of ${menu.maxRolesLimit} roles from this menu.`, ephemeral: true });
                } else {
                    await sendEphemeralEmbed(interaction, menu.limitExceededMessage || `❌ You can only have a maximum of ${menu.maxRolesLimit} roles from this menu.`, "#FF0000", "Limit Exceeded");
                }
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
            if (interaction.isStringSelectMenu()) {
                await sendRoleChangeNotificationFollowUp(interaction, validRolesToAdd, validRolesToRemove, member);
            } else {
                await sendRoleChangeNotification(interaction, validRolesToAdd, validRolesToRemove, member);
            }
        } else {
            if (interaction.isStringSelectMenu()) {
                await interaction.followUp({ content: "No changes made to your roles.", ephemeral: true });
            } else {
                await sendEphemeralEmbed(interaction, "No changes made to your roles.", "#FFFF00", "No Change");
            }
        }

        // Update published message components only if member counts are enabled
        // This prevents "edited" marks while still allowing role functionality
        if (menu.showMemberCounts) {
            await updatePublishedMessageComponents(interaction, menu, menuId, false);
        }

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
        
        if (interaction.isStringSelectMenu()) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await sendEphemeralEmbed(interaction, errorMessage, "#FF0000", "Error");
        }
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


// Performance Dashboard
async function showPerformanceDashboard(interaction) {
  try {
    updateBotHealth();
    
    const embed = new EmbedBuilder()
      .setTitle("🔧 Bot Performance Dashboard")
      .setColor("#00ff00")
      .setTimestamp();

    // Bot Health
    const uptimeHours = Math.floor(performanceMetrics.health.uptime / 3600);
    const uptimeMinutes = Math.floor((performanceMetrics.health.uptime % 3600) / 60);
    
    embed.addFields([
      {
        name: "🤖 Bot Health",
        value: `**Uptime:** ${uptimeHours}h ${uptimeMinutes}m\n**Memory:** ${performanceMetrics.health.memoryUsage.toFixed(1)}MB\n**Status:** ${performanceMetrics.health.uptime > 60 ? '🟢 Healthy' : '🟡 Starting'}`,
        inline: true
      },
      {
        name: "⚡ Performance",
        value: `**Total Interactions:** ${performanceMetrics.interactions.total}\n**Success Rate:** ${performanceMetrics.interactions.total > 0 ? ((performanceMetrics.interactions.successful / performanceMetrics.interactions.total) * 100).toFixed(1) : 0}%\n**Avg Response:** ${performanceMetrics.interactions.averageResponseTime.toFixed(0)}ms`,
        inline: true
      },
      {
        name: "📊 Usage Stats",
        value: `**Menu Interactions:** ${performanceMetrics.menus.interactions}\n**Menus Created:** ${performanceMetrics.menus.created}\n**Menus Published:** ${performanceMetrics.menus.published}`,
        inline: true
      }
    ]);

    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("dash:main")
        .setLabel("Back to Dashboard")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔙"),
      new ButtonBuilder()
        .setCustomId("perf:refresh")
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId("perf:clear")
        .setLabel("Clear Metrics")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️")
    );

    await interaction.editReply({ embeds: [embed], components: [backButton], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error("Error showing performance dashboard:", error);
    await interaction.editReply({ content: "❌ Error showing performance dashboard.", flags: MessageFlags.Ephemeral });
  }
}

// --- Dashboard Functions ---

// Scheduled Messages Dashboard
async function showScheduledMessagesDashboard(interaction) {
  try {
    const schedules = await getScheduledMessages();
    
    const embed = new EmbedBuilder()
      .setTitle("⏰ Scheduled Messages")
      .setDescription("Manage your scheduled info menu deliveries")
      .setColor("#ff9500")
      .setTimestamp();
    
    if (schedules.length === 0) {
      embed.addFields([{
        name: "No Scheduled Messages",
        value: "You haven't scheduled any messages yet. Click 'Schedule New Message' to get started!",
        inline: false
      }]);
    } else {
      const activeSchedules = schedules.filter(s => s.status === 'scheduled');
      const pausedSchedules = schedules.filter(s => s.status === 'paused');
      const completedSchedules = schedules.filter(s => s.status === 'completed');
      const recurringSchedules = schedules.filter(s => s.isRecurring);
      
      embed.addFields([
        {
          name: "📊 Summary",
          value: `**Active:** ${activeSchedules.length}\n**Paused:** ${pausedSchedules.length}\n**Completed:** ${completedSchedules.length}\n**Recurring:** ${recurringSchedules.length}\n**Total:** ${schedules.length}`,
          inline: true
        }
      ]);
      
      // Show next 5 upcoming schedules
      const upcoming = activeSchedules
        .filter(s => new Date(s.scheduledTime) > new Date())
        .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))
        .slice(0, 5);
      
      if (upcoming.length > 0) {
        const upcomingText = upcoming.map(schedule => {
          const channel = client.channels.cache.get(schedule.channelId);
          const timeStr = `<t:${Math.floor(new Date(schedule.scheduledTime).getTime() / 1000)}:R>`;
          const recurringStr = schedule.isRecurring ? ` (${schedule.recurringDisplay})` : '';
          const jsonPreview = JSON.stringify(schedule.messageContent).substring(0, 50);
          return `**Message Preview:** ${jsonPreview}...\n📍 ${channel?.name || 'Unknown Channel'}\n⏰ ${timeStr}${recurringStr}`;
        }).join('\n\n');
        
        embed.addFields([{
          name: "🔜 Upcoming Schedules",
          value: upcomingText,
          inline: false
        }]);
      }
    }
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("schedule:new")
        .setLabel("Schedule New Message")
        .setStyle(ButtonStyle.Success)
        .setEmoji("➕"),
      new ButtonBuilder()
        .setCustomId("schedule:manage")
        .setLabel("Manage Schedules")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📝")
        .setDisabled(schedules.length === 0),
      new ButtonBuilder()
        .setCustomId("schedule:refresh")
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId("dash:main")
        .setLabel("Back to Dashboard")
        .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.editReply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error("Error showing scheduled messages dashboard:", error);
    await interaction.editReply({ content: "❌ Error loading scheduled messages dashboard.", flags: MessageFlags.Ephemeral });
  }
}

// Dynamic Content Help
async function showDynamicContentHelp(interaction) {
  try {
    const embed = new EmbedBuilder()
      .setTitle("🔮 Dynamic Content Variables")
      .setDescription("Use these variables in your info menu pages to create dynamic content!")
      .setColor("#9932cc")
      .setTimestamp();
    
    const variableGroups = [
      {
        name: "👤 User Variables",
        value: "• `{user}` - Mentions the user\n• `{user.name}` - User's display name\n• `{user.id}` - User's ID\n• `{user.avatar}` - User's avatar URL\n• `{user.joined}` - When user joined server"
      },
      {
        name: "🏠 Server Variables", 
        value: "• `{server}` - Server name\n• `{server.id}` - Server ID\n• `{server.members}` - Member count\n• `{server.icon}` - Server icon URL"
      },
      {
        name: "⏰ Time Variables",
        value: "• `{time}` - Current time (full)\n• `{time.short}` - Current time (short)\n• `{date}` - Current date\n• `{timestamp}` - Relative timestamp"
      },
      {
        name: "🎲 Random Variables",
        value: "• `{random.number}` - Random number (1-100)\n• `{random.color}` - Random hex color"
      },
      {
        name: "🤖 Bot Variables",
        value: "• `{bot.name}` - Bot's name\n• `{bot.ping}` - Bot's ping\n• `{bot.uptime}` - Bot's uptime"
      },
      {
        name: "📸 Rich Media Support",
        value: "• Direct image URLs will be auto-detected\n• Videos, audio, and documents are supported\n• Media info will be shown automatically"
      }
    ];
    
    embed.addFields(variableGroups);
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("dynamic:test")
        .setLabel("Test Variables")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🧪"),
      new ButtonBuilder()
        .setCustomId("dash:main")
        .setLabel("Back to Dashboard")
        .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.editReply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error("Error showing dynamic content help:", error);
    await interaction.editReply({ content: "❌ Error loading dynamic content help.", flags: MessageFlags.Ephemeral });
  }
}

// Schedule New Message Menu
async function showScheduleNewMessageMenu(interaction) {
  try {
    const infoMenus = db.getInfoMenus(interaction.guildId);
    
    if (infoMenus.length === 0) {
      await interaction.editReply({ 
        content: "❌ No info menus found. Create some info menus first before scheduling messages.",
        flags: MessageFlags.Ephemeral 
      });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setTitle("📅 Schedule New Message")
      .setDescription("Select an info menu to schedule for delivery")
      .setColor("#00ff00");
    
    const menuOptions = infoMenus.slice(0, 25).map(menu => ({
      label: menu.name,
      value: `schedule_menu:${menu.id}`,
      description: `${menu.pages.length} pages • ${menu.messageId ? 'Published' : 'Draft'}`,
      emoji: menu.pages[0]?.emoji || '📋'
    }));
    
    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("schedule:select_menu")
        .setPlaceholder("Choose an info menu to schedule...")
        .addOptions(menuOptions)
    );
    
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("schedule:back")
        .setLabel("Back to Schedules")
        .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.editReply({ 
      embeds: [embed], 
      components: [selectRow, buttonRow], 
      flags: MessageFlags.Ephemeral 
    });
  } catch (error) {
    console.error("Error showing schedule new message menu:", error);
    await interaction.editReply({ content: "❌ Error loading schedule menu.", flags: MessageFlags.Ephemeral });
  }
}

// Show manage schedules menu
async function showManageSchedulesMenu(interaction) {
  try {
    const schedules = await getScheduledMessages();
    
    if (schedules.length === 0) {
      await interaction.editReply({ 
        content: "❌ No scheduled messages found. Create some schedules first!",
        flags: MessageFlags.Ephemeral 
      });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setTitle("📝 Manage Scheduled Messages")
      .setDescription("Select a scheduled message to edit or delete")
      .setColor("#ffa500");
    
    const scheduleOptions = schedules.slice(0, 25).map(schedule => {
      const channel = client.channels.cache.get(schedule.channelId);
      const timeStr = `<t:${Math.floor(new Date(schedule.scheduledTime).getTime() / 1000)}:R>`;
      
      // Get a preview of the message content
      let messagePreview = "Unknown Message";
      if (schedule.messageContent) {
        if (schedule.messageContent.content) {
          messagePreview = schedule.messageContent.content.substring(0, 50);
        } else if (schedule.messageContent.embeds && schedule.messageContent.embeds[0]) {
          messagePreview = schedule.messageContent.embeds[0].title || schedule.messageContent.embeds[0].description || "Embed Message";
          messagePreview = messagePreview.substring(0, 50);
        }
      }
      
      // Get status emoji
      let statusEmoji = '⏰'; // default
      if (schedule.isRecurring) {
        statusEmoji = '🔄';
      }
      if (schedule.status === 'paused') {
        statusEmoji = '⏸️';
      } else if (schedule.status === 'completed') {
        statusEmoji = '✅';
      }
      
      return {
        label: messagePreview,
        value: `manage_schedule:${schedule.id}`,
        description: `${channel?.name || 'Unknown Channel'} • ${timeStr} • ${getStatusDisplay(schedule.status)}`,
        emoji: statusEmoji
      };
    });
    
    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("schedule:select_manage")
        .setPlaceholder("Choose a schedule to manage...")
        .addOptions(scheduleOptions)
    );
    
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("schedule:back")
        .setLabel("Back to Schedules")
        .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.editReply({ 
      embeds: [embed], 
      components: [selectRow, buttonRow], 
      flags: MessageFlags.Ephemeral 
    });
  } catch (error) {
    console.error("Error showing manage schedules menu:", error);
    await interaction.editReply({ content: "❌ Error loading manage schedules menu.", flags: MessageFlags.Ephemeral });
  }
}

// Show schedule details menu
async function showScheduleDetailsMenu(interaction, scheduleId) {
  try {
    const schedule = scheduledMessages.get(scheduleId);
    if (!schedule) {
      await interaction.editReply({ 
        content: "❌ Schedule not found.",
        flags: MessageFlags.Ephemeral 
      });
      return;
    }

    const channel = client.channels.cache.get(schedule.channelId);
    const timeStr = `<t:${Math.floor(new Date(schedule.scheduledTime).getTime() / 1000)}:F>`;
    
    // Get a preview of the message content
    let messagePreview = "Unknown Message";
    if (schedule.messageContent) {
      if (schedule.messageContent.content) {
        messagePreview = schedule.messageContent.content.substring(0, 100);
      } else if (schedule.messageContent.embeds && schedule.messageContent.embeds[0]) {
        messagePreview = schedule.messageContent.embeds[0].title || schedule.messageContent.embeds[0].description || "Embed Message";
        messagePreview = messagePreview.substring(0, 100);
      }
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`📝 Schedule Details - ${schedule.id}`)
      .setDescription("Manage this scheduled message")
      .setColor("#ffa500")
      .addFields([
        { name: "Channel", value: channel ? `<#${schedule.channelId}>` : 'Unknown Channel', inline: true },
        { name: "Status", value: getStatusDisplay(schedule.status), inline: true },
        { name: "Scheduled Time", value: timeStr, inline: true },
        { name: "Recurring", value: schedule.isRecurring ? `Yes (${schedule.recurringDisplay})` : "No", inline: true },
        { name: "Auto-delete", value: schedule.autoDeleteDuration ? `${schedule.autoDeleteDuration} minutes` : "No", inline: true },
        { name: "Webhook", value: schedule.useWebhook ? `Yes (${schedule.webhookName || 'Custom'})` : "No", inline: true },
        { name: "Message Preview", value: `\`\`\`${messagePreview}${messagePreview.length >= 100 ? '...' : ''}\`\`\``, inline: false }
      ]);

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`schedule:toggle:${scheduleId}`)
        .setLabel(schedule.status === 'scheduled' ? 'Pause' : 'Resume')
        .setStyle(schedule.status === 'scheduled' ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji(schedule.status === 'scheduled' ? '⏸️' : '▶️'),
      new ButtonBuilder()
        .setCustomId(`schedule:webhook:${scheduleId}`)
        .setLabel('Configure Webhook')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔗'),
      new ButtonBuilder()
        .setCustomId(`schedule:delete:${scheduleId}`)
        .setLabel('Delete')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️')
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("schedule:back")
        .setLabel("Back to Manage")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ 
      embeds: [embed], 
      components: [row1, row2], 
      flags: MessageFlags.Ephemeral 
    });
  } catch (error) {
    console.error("Error showing schedule details menu:", error);
    await interaction.editReply({ content: "❌ Error loading schedule details.", flags: MessageFlags.Ephemeral });
  }
}

// Rich Media Support and Dynamic Content System
const dynamicContentVariables = {
  // User variables
  '{user}': (interaction) => `<@${interaction.user.id}>`,
  '{user.name}': (interaction) => interaction.user.displayName || interaction.user.username,
  '{user.id}': (interaction) => interaction.user.id,
  '{user.avatar}': (interaction) => interaction.user.displayAvatarURL(),
  '{user.joined}': (interaction) => interaction.member?.joinedAt ? `<t:${Math.floor(interaction.member.joinedAt.getTime() / 1000)}:R>` : 'Unknown',
  
  // Server variables
  '{server}': (interaction) => interaction.guild?.name || 'Unknown Server',
  '{server.id}': (interaction) => interaction.guild?.id || 'Unknown',
  '{server.members}': (interaction) => interaction.guild?.memberCount || 'Unknown',
  '{server.icon}': (interaction) => interaction.guild?.iconURL() || '',
  
  // Time variables
  '{time}': () => `<t:${Math.floor(Date.now() / 1000)}:F>`,
  '{time.short}': () => `<t:${Math.floor(Date.now() / 1000)}:t>`,
  '{date}': () => `<t:${Math.floor(Date.now() / 1000)}:D>`,
  '{timestamp}': () => `<t:${Math.floor(Date.now() / 1000)}:R>`,
  
  // Random variables
  '{random.number}': () => Math.floor(Math.random() * 100) + 1,
  '{random.color}': () => '#' + Math.floor(Math.random()*16777215).toString(16),
  
  // Bot variables
  '{bot.name}': () => client.user?.username || 'Bot',
  '{bot.ping}': () => `${client.ws.ping}ms`,
  '{bot.uptime}': () => {
    if (!performanceMetrics) return '0h 0m';
    const uptime = performanceMetrics.health.uptime;
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
};

// Process dynamic content
function processDynamicContent(content, interaction) {
  if (!content || typeof content !== 'string') return content;
  
  let processedContent = content;
  
  // Replace all dynamic variables
  for (const [variable, resolver] of Object.entries(dynamicContentVariables)) {
    if (processedContent.includes(variable)) {
      try {
        const value = resolver(interaction);
        processedContent = processedContent.replaceAll(variable, value);
      } catch (error) {
        console.error(`Error processing dynamic variable ${variable}:`, error);
        processedContent = processedContent.replaceAll(variable, `[Error: ${variable}]`);
      }
    }
  }
  
  return processedContent;
}

// Rich media validation and processing
function validateAndProcessRichMedia(content) {
  const richMediaPatterns = {
    // Image URLs
    image: /\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?$/i,
    // Video URLs
    video: /\.(mp4|webm|mov)(\?[^\s]*)?$/i,
    // Audio URLs
    audio: /\.(mp3|wav|ogg)(\?[^\s]*)?$/i,
    // Document URLs
    document: /\.(pdf|doc|docx|txt)(\?[^\s]*)?$/i
  };
  
  const urls = content.match(/https?:\/\/[^\s]+/g) || [];
  const mediaInfo = {
    images: [],
    videos: [],
    audio: [],
    documents: [],
    hasRichMedia: false
  };
  
  urls.forEach(url => {
    if (richMediaPatterns.image.test(url)) {
      mediaInfo.images.push(url);
      mediaInfo.hasRichMedia = true;
    } else if (richMediaPatterns.video.test(url)) {
      mediaInfo.videos.push(url);
      mediaInfo.hasRichMedia = true;
    } else if (richMediaPatterns.audio.test(url)) {
      mediaInfo.audio.push(url);
      mediaInfo.hasRichMedia = true;
    } else if (richMediaPatterns.document.test(url)) {
      mediaInfo.documents.push(url);
      mediaInfo.hasRichMedia = true;
    }
  });
  
  return mediaInfo;
}

// Enhanced embed builder with rich media support
function createEnhancedEmbed(page, interaction) {
  const processedTitle = processDynamicContent(page.title, interaction);
  const processedDescription = processDynamicContent(page.desc, interaction);
  
  const embed = new EmbedBuilder()
    .setTitle(processedTitle)
    .setDescription(processedDescription)
    .setColor(page.color || "#5865F2");
  
  // Process rich media
  const mediaInfo = validateAndProcessRichMedia(processedDescription);
  
  // Set image if found
  if (mediaInfo.images.length > 0) {
    embed.setImage(mediaInfo.images[0]);
  }
  
  // Add media info field if rich media detected
  if (mediaInfo.hasRichMedia) {
    const mediaTypes = [];
    if (mediaInfo.images.length > 0) mediaTypes.push(`📸 ${mediaInfo.images.length} image(s)`);
    if (mediaInfo.videos.length > 0) mediaTypes.push(`🎥 ${mediaInfo.videos.length} video(s)`);
    if (mediaInfo.audio.length > 0) mediaTypes.push(`🎵 ${mediaInfo.audio.length} audio file(s)`);
    if (mediaInfo.documents.length > 0) mediaTypes.push(`📄 ${mediaInfo.documents.length} document(s)`);
    
    if (mediaTypes.length > 0) {
      embed.addFields([{
        name: "📎 Rich Media Detected",
        value: mediaTypes.join('\n'),
        inline: true
      }]);
    }
  }
  
  return embed;
}

// Scheduled Messages System
const scheduledMessages = new Map(); // messageId -> scheduleData
const activeSchedules = new Map(); // scheduleId -> timeout

// Schedule data structure
class ScheduleData {
  constructor(options) {
    this.id = options.id || generateId();
    this.menuId = options.menuId;
    this.channelId = options.channelId;
    this.scheduleTime = options.scheduleTime; // Date object
    this.recurring = options.recurring || false;
    this.recurringInterval = options.recurringInterval || 'daily'; // daily, weekly, monthly
    this.isActive = options.isActive || true;
    this.createdBy = options.createdBy;
    this.createdAt = options.createdAt || Date.now();
  }
}

// Get all scheduled messages
async function getScheduledMessages() {
  return await db.getScheduledMessages();
}

// Initialize scheduled messages on bot start
async function initializeScheduledMessages() {
  try {
    // Load existing scheduled messages from Firebase
    console.log("Loading scheduled messages from database...");
    const schedules = await db.getScheduledMessages();
    console.log(`Loaded ${schedules.length} scheduled messages from database`);
    
    // Check for scheduled messages every minute
    setInterval(checkScheduledMessages, 60000); // Check every minute
    console.log("Scheduled messages system initialized");
  } catch (error) {
    console.error("Error initializing scheduled messages:", error);
    console.log("Starting scheduled messages system without database data");
    setInterval(checkScheduledMessages, 60000);
  }
}

// Check and execute scheduled messages
async function checkScheduledMessages() {
  try {
    const now = new Date();
    
    // Check all scheduled messages
    for (const [scheduleId, schedule] of scheduledMessages) {
      if (schedule.status !== 'scheduled') continue;
      
      const scheduledTime = new Date(schedule.scheduledTime);
      
      // Check if it's time to send the message
      if (now >= scheduledTime) {
        console.log(`Executing scheduled message: ${scheduleId}`);
        await executeScheduledMessage(schedule);
        
        // Handle recurring messages
        if (schedule.isRecurring && schedule.recurringInterval) {
          // Schedule the next occurrence
          const nextTime = new Date(scheduledTime.getTime() + schedule.recurringInterval);
          schedule.scheduledTime = nextTime.toISOString();
          
          // Update in database
          db.saveScheduledMessage(schedule);
          console.log(`Recurring message rescheduled for: ${nextTime.toISOString()}`);
        } else {
          // Mark as completed for non-recurring messages
          schedule.status = 'completed';
          db.saveScheduledMessage(schedule);
          console.log(`Non-recurring message completed: ${scheduleId}`);
        }
      }
    }
  } catch (error) {
    console.error("Error checking scheduled messages:", error);
  }
}

// Execute a scheduled message
async function executeScheduledMessage(schedule) {
  try {
    const channel = client.channels.cache.get(schedule.channelId);
    if (!channel || !channel.isTextBased()) {
      console.error(`Invalid channel for scheduled message ${schedule.id}: ${schedule.channelId}`);
      return;
    }

    // Delete previous message if this is a recurring message
    if (schedule.isRecurring && schedule.lastMessageId) {
      try {
        const previousMessage = await channel.messages.fetch(schedule.lastMessageId);
        await previousMessage.delete();
        console.log(`Deleted previous recurring message: ${schedule.lastMessageId}`);
      } catch (error) {
        console.warn(`Could not delete previous message ${schedule.lastMessageId}:`, error.message);
      }
    }

    let sentMessage;
    
    // Send the message using webhook if configured
    if (schedule.useWebhook) {
      try {
        // Get or create webhook for the channel
        const webhook = await getOrCreateWebhook(
          channel, 
          schedule.webhookName || "Scheduled Message Webhook"
        );
        
        // Prepare webhook options
        const webhookOptions = {
          ...schedule.messageContent,
          username: schedule.webhookName || "Scheduled Message",
          avatarURL: schedule.webhookAvatar || null
        };
        
        sentMessage = await webhook.send(webhookOptions);
        console.log(`Sent scheduled message ${schedule.id} via webhook to ${channel.name}`);
      } catch (webhookError) {
        console.warn(`Failed to send via webhook for schedule ${schedule.id}, falling back to normal message:`, webhookError.message);
        // Fall back to normal message sending
        sentMessage = await channel.send(schedule.messageContent);
        console.log(`Sent scheduled message ${schedule.id} (fallback) to ${channel.name}`);
      }
    } else {
      // Send the message normally
      sentMessage = await channel.send(schedule.messageContent);
      console.log(`Sent scheduled message ${schedule.id} to ${channel.name}`);
    }

    // Update the lastMessageId for recurring messages
    if (schedule.isRecurring) {
      schedule.lastMessageId = sentMessage.id;
      scheduledMessages.set(schedule.id, schedule);
    }

    // Handle auto-delete if specified
    if (schedule.autoDeleteDuration) {
      setTimeout(async () => {
        try {
          await sentMessage.delete();
          console.log(`Auto-deleted message ${sentMessage.id} after ${schedule.autoDeleteDuration} minutes`);
        } catch (error) {
          console.warn(`Could not auto-delete message ${sentMessage.id}:`, error.message);
        }
      }, schedule.autoDeleteDuration * 60 * 1000);
    }

  } catch (error) {
    console.error(`Error executing scheduled message ${schedule.id}:`, error);
  }
}

// Utility function to generate IDs
function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Helper function to get status display text
function getStatusDisplay(status) {
  switch (status) {
    case 'scheduled':
      return 'Active';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Completed';
    default:
      return 'Unknown';
  }
}

/**
 * Creates the embed for a hybrid menu
 * @param {Guild} guild - The Discord guild
 * @param {Object} menu - The hybrid menu object
 * @returns {EmbedBuilder} The created embed
 */
async function createHybridMenuEmbed(guild, menu) {
    const embed = new EmbedBuilder()
        .setTitle(menu.name)
        .setDescription(menu.desc)
        .setColor(menu.embedColor || "#5865F2");

    if (menu.embedThumbnail) embed.setThumbnail(menu.embedThumbnail);
    if (menu.embedImage) embed.setImage(menu.embedImage);
    
    if (menu.embedAuthorName) {
        embed.setAuthor({
            name: menu.embedAuthorName,
            iconURL: menu.embedAuthorIconURL
        });
    }

    if (menu.embedFooterText) {
        embed.setFooter({
            text: menu.embedFooterText,
            iconURL: menu.embedFooterIconURL
        });
    }

    return embed;
}

/**
 * Builds the components for a hybrid menu
 * @param {Object} interaction - The Discord interaction
 * @param {Object} menu - The hybrid menu object
 * @param {string} hybridMenuId - The hybrid menu ID
 * @returns {Array} Array of ActionRowBuilder components
 */
async function buildHybridMenuComponents(interaction, menu, hybridMenuId) {
    const components = [];

    // Get component order (default: dropdowns first, then buttons)
    const componentOrder = menu.componentOrder || {
        infoDropdown: 1,
        roleDropdown: 2,
        infoButtons: 3,
        roleButtons: 4
    };

    // Create component objects with their order
    const componentParts = [];

    // Helper function to determine if an item should be shown in a specific display type
    const shouldShowInDisplay = (item, itemType, displayType) => {
        if (itemType === 'info') {
            // For info pages, use the displayType stored directly on the page
            const pageDisplayType = item.displayType || 'dropdown'; // Default to dropdown for legacy pages
            return pageDisplayType === displayType;
        } else if (itemType === 'role') {
            // For roles, they're already separated into dropdownRoles and buttonRoles
            // This function will be called appropriately for each type
            return true;
        }
        
        return false;
    };

    // Filter info pages for dropdown display
    const dropdownInfoPages = menu.pages ? menu.pages.filter(page => 
        shouldShowInDisplay(page, 'info', 'dropdown')
    ) : [];

    // Filter info pages for button display  
    const buttonInfoPages = menu.pages ? menu.pages.filter(page =>
        shouldShowInDisplay(page, 'info', 'button')
    ) : [];

    // Use roles directly from their configured arrays (no filtering needed since they're already categorized)
    const dropdownRoles = menu.dropdownRoles || [];
    const buttonRoles = menu.buttonRoles || [];

    // Add info pages dropdown if we have pages to show
    if (dropdownInfoPages.length > 0) {
        const infoOptions = dropdownInfoPages.slice(0, 25).map(page => ({
            label: (page.name || page.title || 'Untitled Page').substring(0, 100),
            value: `hybrid-info-page:${hybridMenuId}:${page.id}`,
            description: (page.content || page.description || 'No description').substring(0, 100),
            emoji: page.emoji || '📄'
        }));

        const infoDropdown = new StringSelectMenuBuilder()
            .setCustomId(`hybrid-info-select:${hybridMenuId}`)
            .setPlaceholder(menu.infoDropdownPlaceholder || "📚 Select a page to view...")
            .addOptions(infoOptions);
        
        componentParts.push({
            order: componentOrder.infoDropdown || 1,
            type: 'infoDropdown',
            component: new ActionRowBuilder().addComponents(infoDropdown)
        });
    }

    // Add roles dropdown if we have roles to show
    if (dropdownRoles.length > 0) {
        const roleOptions = dropdownRoles.map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return null;
            
            // Get member count if enabled for dropdowns
            const memberCountOptions = menu.memberCountOptions || {};
            const showCountsInDropdowns = memberCountOptions.showInDropdowns || (menu.showMemberCounts && !memberCountOptions.showInButtons);
            const memberCount = showCountsInDropdowns ? role.members.size : null;
            const labelText = memberCount !== null 
                ? `${role.name} (${memberCount})` 
                : role.name;
            
            return {
                label: labelText.substring(0, 100),
                value: role.id,
                emoji: parseEmoji(menu.dropdownEmojis?.[role.id]) || '🎭',
                description: menu.dropdownRoleDescriptions?.[role.id]?.substring(0, 100),
                default: false
            };
        }).filter(Boolean);

        if (roleOptions.length > 0) {
            const roleDropdown = new StringSelectMenuBuilder()
                .setCustomId(`hybrid-role-select:${hybridMenuId}`)
                .setPlaceholder(menu.roleDropdownPlaceholder || "🎭 Select roles to toggle...")
                .setMinValues(1)
                .setMaxValues(roleOptions.length)
                .addOptions(roleOptions);
            
            componentParts.push({
                order: componentOrder.roleDropdown || 2,
                type: 'roleDropdown',
                component: new ActionRowBuilder().addComponents(roleDropdown)
            });
        }
    }

    // Add info pages buttons if we have pages to show as buttons
    if (buttonInfoPages.length > 0) {
        const buttonRows = [];
        let currentRow = new ActionRowBuilder();
        let buttonsInRow = 0;

        buttonInfoPages.forEach(page => {
            if (buttonsInRow >= 5) {
                buttonRows.push(currentRow);
                currentRow = new ActionRowBuilder();
                buttonsInRow = 0;
            }

            const button = new ButtonBuilder()
                .setCustomId(`hybrid-info-page:${hybridMenuId}:${page.id}`)
                .setLabel((page.name || page.title || 'Untitled Page').substring(0, 80))
                .setStyle(ButtonStyle[page.buttonColor] || ButtonStyle.Primary);

            if (page.emoji) button.setEmoji(page.emoji);

            currentRow.addComponents(button);
            buttonsInRow++;
        });

        if (buttonsInRow > 0) {
            buttonRows.push(currentRow);
        }

        componentParts.push({
            order: componentOrder.infoButtons || 3,
            type: 'infoButtons',
            components: buttonRows
        });
    }

    // Add role buttons if we have roles to show as buttons
    if (buttonRoles.length > 0) {
        const buttonRows = [];
        let currentRow = new ActionRowBuilder();
        let buttonsInRow = 0;

        buttonRoles.forEach(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return;

            if (buttonsInRow >= 5) {
                buttonRows.push(currentRow);
                currentRow = new ActionRowBuilder();
                buttonsInRow = 0;
            }

            const buttonColorName = menu.buttonColors?.[role.id] || 'Secondary';
            const buttonStyle = ButtonStyle[buttonColorName] || ButtonStyle.Secondary;

            // Get member count if enabled for buttons
            const memberCountOptions = menu.memberCountOptions || {};
            const showCountsInButtons = memberCountOptions.showInButtons || (menu.showMemberCounts && !memberCountOptions.showInDropdowns);
            const memberCount = showCountsInButtons ? role.members.size : null;
            const labelText = memberCount !== null 
                ? `${role.name} (${memberCount})` 
                : role.name;

            const button = new ButtonBuilder()
                .setCustomId(`hybrid-role-button:${hybridMenuId}:${role.id}`)
                .setLabel(labelText.substring(0, 80))
                .setStyle(buttonStyle);

            if (menu.buttonEmojis?.[role.id]) {
                button.setEmoji(parseEmoji(menu.buttonEmojis[role.id]));
            } else {
                // Add fallback emoji for role buttons to differentiate from info pages
                button.setEmoji('🎭');
            }

            currentRow.addComponents(button);
            buttonsInRow++;
        });

        if (buttonsInRow > 0) {
            buttonRows.push(currentRow);
        }

        componentParts.push({
            order: componentOrder.roleButtons || 4,
            type: 'roleButtons',
            components: buttonRows
        });
    }

    // Sort components by order and add to final components array
    componentParts.sort((a, b) => a.order - b.order);
    
    componentParts.forEach(part => {
        if (part.component) {
            // Single component (dropdowns)
            components.push(part.component);
        } else if (part.components) {
            // Multiple components (button rows)
            components.push(...part.components);
        }
    });

    return components;
}

/**
 * Updates the components of a published hybrid menu message.
 * Only updates if "Show Counts" is enabled to prevent "edited" indicator.
 * @param {Object} interaction - The Discord interaction object.
 * @param {Object} menu - The hybrid menu object.
 * @param {string} hybridMenuId - The ID of the hybrid menu.
 */
async function updatePublishedHybridMenuComponents(interaction, menu, hybridMenuId, forceUpdate = false) {
    // Always rebuild components to reset dropdown selections for better UX
    // But only actually update the message if there are meaningful changes to show
    
    if (!menu || !menu.channelId || !menu.messageId) {
        console.warn(`[updatePublishedHybridMenuComponents] Invalid menu or missing channel/message ID for menu ${hybridMenuId}`);
        return;
    }

    if (!interaction || !interaction.guild) {
        console.warn(`[updatePublishedHybridMenuComponents] Invalid interaction for menu ${hybridMenuId}`);
        return;
    }

    try {
        const originalChannel = await interaction.guild.channels.fetch(menu.channelId).catch(() => null);
        if (!originalChannel || !originalChannel.isTextBased()) {
            console.error(`Channel ${menu.channelId} not found or not text-based for menu ${hybridMenuId}`);
            await db.clearHybridMessageId(hybridMenuId);
            return;
        }

        const originalMessage = await originalChannel.messages.fetch(menu.messageId).catch(() => null);
        if (!originalMessage) {
            console.error(`Message ${menu.messageId} not found for menu ${hybridMenuId}`);
            await db.clearHybridMessageId(hybridMenuId);
            return;
        }

        // Check if we need to show member counts, which would require a message update
        const shouldShowMemberCounts = menu.showMemberCounts;
        
        // Always rebuild components to reset dropdown selections
        const components = await buildHybridMenuComponents(interaction, menu, hybridMenuId);

        // Only update the message if we're showing member counts or if explicitly forced
        // This prevents unnecessary "edited" marks while still resetting dropdown selections
        if (shouldShowMemberCounts || forceUpdate) {
            const publishedEmbed = await createHybridMenuEmbed(interaction.guild, menu);

            // Edit the message
            if (menu.useWebhook) {
                try {
                    const webhookName = menu.webhookName || "Hybrid Menu Webhook";
                    const webhook = await getOrCreateWebhook(originalChannel, webhookName);
                    await webhook.editMessage(originalMessage.id, {
                        embeds: [publishedEmbed],
                        components,
                    });
                } catch (webhookError) {
                    console.error("Error updating hybrid menu via webhook:", webhookError);
                    // Fallback to regular bot message edit
                    await originalMessage.edit({ embeds: [publishedEmbed], components });
                }
            } else {
                await originalMessage.edit({ embeds: [publishedEmbed], components });
            }
        } else {
            // Just update the components to reset dropdown selections without changing the embed
            await originalMessage.edit({ components });
        }

    } catch (error) {
        console.error("Error updating published hybrid menu components:", error);
        // If the message or channel is gone, clear the message ID from the menu
        if (error.code === 10003 || error.code === 50001 || error.code === 10008) { // Unknown Channel, Missing Access, or Unknown Message
            console.log(`Clearing hybrid message ID for menu ${hybridMenuId} due to channel/message access error.`);
            await db.clearHybridMessageId(hybridMenuId);
        }
    }
}

// Show comprehensive display types configuration for hybrid menus
// Show individual item configuration for fine-grained control
async function showIndividualItemConfiguration(interaction, hybridMenuId) {
  try {
    console.log(`[Individual Config Debug] Starting configuration for menu: ${hybridMenuId}`);
    
    const menu = db.getHybridMenu(hybridMenuId);
    if (!menu) {
      return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
    }

    console.log(`[Individual Config Debug] Menu found: ${menu.name}, Pages: ${menu.pages?.length || 0}, Roles: ${[...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])].length}`);

    const embed = new EmbedBuilder()
      .setTitle(`⚙️ Individual Item Configuration: ${menu.name}`)
      .setDescription(`**Configure display types for individual items:**\n\n` +
        `Click any item to cycle through: Dropdown → Button → Both → Hidden → Default`)
      .setColor("#5865F2");

  const components = [];

  // Get current overrides
  const infoOverrides = menu.displayTypes || {};
  const roleOverrides = menu.roleDisplayTypes || {};
  const infoDefault = menu.defaultInfoDisplayType || 'dropdown';
  const roleDefault = menu.defaultRoleDisplayType || 'dropdown';

  // Info Pages
  const infoPages = menu.pages || [];
  const allRoles = [...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])];
  
  // Conservative limit: max 10 items total (2 rows of 5 buttons each = 10 buttons + 1 back button row = 3 total rows)
  const maxItems = 10;
  const totalItems = infoPages.length + allRoles.length;
  
  if (totalItems > maxItems) {
    embed.setDescription(`**Too many items to configure individually (${totalItems} items).**\n\n` +
      `Please use the **Display Types Configuration** page instead for:\n` +
      `• Menu-wide defaults\n` +
      `• Bulk setup wizard\n` +
      `• Overview of all items`);
    
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`hybrid:back_to_display_types:${hybridMenuId}`)
        .setLabel("← Back to Display Types")
        .setStyle(ButtonStyle.Primary)
    );
    
    return interaction.editReply({
      embeds: [embed],
      components: [backRow],
      flags: MessageFlags.Ephemeral
    });
  }

  if (infoPages.length > 0) {
    embed.addFields([
      { name: "📋 Info Pages", value: "Click to configure each page:", inline: false }
    ]);

    const infoRows = [];
    let currentRow = new ActionRowBuilder();
    let buttonsInRow = 0;

    for (const page of infoPages.slice(0, 5)) { // Limit to 5 items to stay well within Discord's limits
      if (buttonsInRow >= 5) {
        infoRows.push(currentRow);
        currentRow = new ActionRowBuilder();
        buttonsInRow = 0;
      }

      const override = infoOverrides[page.id];
      const displayType = override || infoDefault;
      const isOverridden = !!override;
      
      const displayEmoji = {
        'dropdown': '📋',
        'button': '🔘',
        'both': '📋🔘',
        'hidden': '❌'
      }[displayType] || '📋';

      const button = new ButtonBuilder()
        .setCustomId(`hybrid:toggle_page_display:${hybridMenuId}:${page.id}`)
        .setLabel(`${page.name.substring(0, 20)}`)
        .setEmoji(displayEmoji)
        .setStyle(isOverridden ? ButtonStyle.Primary : ButtonStyle.Secondary);

      currentRow.addComponents(button);
      buttonsInRow++;
    }

    if (buttonsInRow > 0) {
      infoRows.push(currentRow);
    }

    components.push(...infoRows);
  }

  // Roles
  if (allRoles.length > 0) {
    embed.addFields([
      { name: "🎭 Reaction Roles", value: "Click to configure each role:", inline: false }
    ]);

    const roleRows = [];
    let currentRow = new ActionRowBuilder();
    let buttonsInRow = 0;

    for (const roleId of allRoles.slice(0, 5)) { // Limit to 5 items to stay well within Discord's limits
      if (buttonsInRow >= 5) {
        roleRows.push(currentRow);
        currentRow = new ActionRowBuilder();
        buttonsInRow = 0;
      }

      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) continue;

      const override = roleOverrides[roleId];
      const displayType = override || roleDefault;
      const isOverridden = !!override;
      
      const displayEmoji = {
        'dropdown': '📋',
        'button': '🔘',
        'both': '📋🔘',
        'hidden': '❌'
      }[displayType] || '📋';

      const button = new ButtonBuilder()
        .setCustomId(`hybrid:toggle_role_display:${hybridMenuId}:${roleId}`)
        .setLabel(`${role.name.substring(0, 20)}`)
        .setEmoji(displayEmoji)
        .setStyle(isOverridden ? ButtonStyle.Primary : ButtonStyle.Secondary);

      currentRow.addComponents(button);
      buttonsInRow++;
    }

    if (buttonsInRow > 0) {
      roleRows.push(currentRow);
    }

    components.push(...roleRows);
  }

  // Back button
  // Discord limits components to 5 action rows maximum
  // Reserve 1 row for the back button
  const maxContentRows = 4;
  
  if (components.length > maxContentRows) {
    // Keep only the first maxContentRows, then add back button
    components.splice(maxContentRows);
    embed.setFooter({ text: "⚠️ Showing first few items only due to Discord limits. Use Display Types Configuration for overview." });
  }

  // Always add the back button last
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:back_to_display_types:${hybridMenuId}`)
      .setLabel("← Back to Display Types")
      .setStyle(ButtonStyle.Secondary)
  );

  components.push(backRow);

  // Debug logging to understand component structure
  console.log(`[Individual Config Debug] Total components: ${components.length}`);
  console.log(`[Individual Config Debug] Component types:`, components.map(c => c.components?.length || 0));

  // Validate components before sending
  if (components.length > 5) {
    console.error(`[Individual Config Error] Too many components: ${components.length}, Discord limit is 5`);
    return sendEphemeralEmbed(interaction, "❌ Too many items to configure at once. Please use the Display Types Configuration page instead.", "#FF0000", "Error", false);
  }

  await interaction.editReply({
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral
  });
  
  } catch (error) {
    console.error(`[Individual Config Error] Error in showIndividualItemConfiguration:`, error);
    return sendEphemeralEmbed(interaction, "❌ Error loading individual item configuration. Please try again.", "#FF0000", "Error", false);
  }
}

/**
 * Handle hybrid menu user interactions (published hybrid menus)
 * @param {import('discord.js').Interaction} interaction - The interaction to handle
 */
async function handleHybridMenuInteraction(interaction) {
  // Deferring is now handled at the main interaction level
  // Dropdown interactions use deferUpdate, button interactions use deferReply

  try {
    const parts = interaction.customId.split(":");
    const type = parts[0]; // "hybrid-info-select", "hybrid-role-select", "hybrid-info-page", or "hybrid-role-button"
    const hybridMenuId = parts[1];
    
    if (!hybridMenuId) {
      if (interaction.isStringSelectMenu()) {
        return interaction.followUp({ content: "❌ Invalid hybrid menu configuration.", ephemeral: true });
      } else {
        return sendEphemeralEmbed(interaction, "❌ Invalid hybrid menu configuration.", "#FF0000", "Error", false);
      }
    }

    const menu = db.getHybridMenu(hybridMenuId);
    if (!menu) {
      if (interaction.isStringSelectMenu()) {
        return interaction.followUp({ content: "❌ Hybrid menu not found.", ephemeral: true });
      } else {
        return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
      }
    }

    // Handle info page interactions
    if (type === "hybrid-info-select") {
      const selectedPageId = interaction.values[0].split(':')[2]; // Extract page ID from value
      const page = menu.pages?.find(p => p.id === selectedPageId);
      
      if (!page) {
        return interaction.followUp({ content: "❌ Page not found.", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(page.name)
        .setDescription(page.content)
        .setColor(page.embedData?.color || menu.embedColor || "#5865F2");

      if (page.embedData) {
        if (page.embedData.thumbnail?.url) embed.setThumbnail(page.embedData.thumbnail.url);
        if (page.embedData.image?.url) embed.setImage(page.embedData.image.url);
        if (page.embedData.author?.name) {
          embed.setAuthor({
            name: page.embedData.author.name,
            iconURL: page.embedData.author.icon_url
          });
        }
        if (page.embedData.footer?.text) {
          embed.setFooter({
            text: page.embedData.footer.text,
            iconURL: page.embedData.footer.icon_url
          });
        }
        if (page.embedData.fields) {
          embed.addFields(page.embedData.fields);
        }
      }

      // Clear the dropdown selection after showing the info page
      // For dropdown interactions, don't update the message to prevent "edited" marks
      // The dropdown selection will naturally reset since we used deferUpdate()

      return interaction.followUp({ embeds: [embed], ephemeral: true });
    }

    if (type === "hybrid-info-page") {
      const pageId = parts[2];
      const page = menu.pages?.find(p => p.id === pageId);
      
      if (!page) {
        return sendEphemeralEmbed(interaction, "❌ Page not found.", "#FF0000", "Error", false);
      }

      const embed = new EmbedBuilder()
        .setTitle(page.name)
        .setDescription(page.content)
        .setColor(page.embedData?.color || menu.embedColor || "#5865F2");

      if (page.embedData) {
        if (page.embedData.thumbnail?.url) embed.setThumbnail(page.embedData.thumbnail.url);
        if (page.embedData.image?.url) embed.setImage(page.embedData.image.url);
        if (page.embedData.author?.name) {
          embed.setAuthor({
            name: page.embedData.author.name,
            iconURL: page.embedData.author.icon_url
          });
        }
        if (page.embedData.footer?.text) {
          embed.setFooter({
            text: page.embedData.footer.text,
            iconURL: page.embedData.footer.icon_url
          });
        }
        if (page.embedData.fields) {
          embed.addFields(page.embedData.fields);
        }
      }

      return interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // Handle role interactions
    if (type === "hybrid-role-select") {
      const selectedRoleIds = interaction.values;
      
      if (!interaction.guild || !interaction.member) {
        return interaction.followUp({ content: "❌ Unable to process role interaction.", ephemeral: true });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) {
        return interaction.followUp({ content: "❌ Unable to fetch member information.", ephemeral: true });
      }

      const currentRoles = new Set(member.roles.cache.map(r => r.id));
      let newRoles = new Set(currentRoles);

      // Toggle each selected role
      for (const roleId of selectedRoleIds) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) continue;

        if (newRoles.has(roleId)) {
          newRoles.delete(roleId);
        } else {
          newRoles.add(roleId);
        }
      }

      const rolesToAdd = Array.from(newRoles).filter(id => !currentRoles.has(id));
      const rolesToRemove = Array.from(currentRoles).filter(id => !newRoles.has(id));

      // Apply role changes
      if (rolesToAdd.length > 0) {
        await member.roles.add(rolesToAdd);
      }
      if (rolesToRemove.length > 0) {
        await member.roles.remove(rolesToRemove);
      }

      // Update the published message components to clear selections and update member counts
      // For dropdown interactions, don't update the message to prevent "edited" marks
      // The dropdown selection will naturally reset since we used deferUpdate()

      // Send confirmation
      let message = "✅ Roles updated successfully!";
      if (rolesToAdd.length > 0) {
        const addedRoles = rolesToAdd.map(id => `<@&${id}>`).join(', ');
        message += `\n**Added:** ${addedRoles}`;
      }
      if (rolesToRemove.length > 0) {
        const removedRoles = rolesToRemove.map(id => `<@&${id}>`).join(', ');
        message += `\n**Removed:** ${removedRoles}`;
      }

      // Update member counts only if enabled
      if (menu.showMemberCounts) {
        try {
          await updatePublishedHybridMenuComponents(interaction, menu, hybridMenuId, false);
        } catch (error) {
          console.error("Error updating hybrid menu components:", error);
        }
      }

      return interaction.followUp({ content: message, ephemeral: true });
    }

    if (type === "hybrid-role-button") {
      const roleId = parts[2];
      
      if (!interaction.guild || !interaction.member) {
        return sendEphemeralEmbed(interaction, "❌ Unable to process role interaction.", "#FF0000", "Error", false);
      }

      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) {
        return sendEphemeralEmbed(interaction, "❌ Role not found.", "#FF0000", "Error", false);
      }

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) {
        return sendEphemeralEmbed(interaction, "❌ Unable to fetch member information.", "#FF0000", "Error", false);
      }

      const hasRole = member.roles.cache.has(roleId);
      
      if (hasRole) {
        await member.roles.remove(roleId);
        return sendEphemeralEmbed(interaction, `✅ Removed role: <@&${roleId}>`, "#00FF00", "Success", false);
      } else {
        await member.roles.add(roleId);
        return sendEphemeralEmbed(interaction, `✅ Added role: <@&${roleId}>`, "#00FF00", "Success", false);
      }
    }

    return sendEphemeralEmbed(interaction, "❌ Unknown interaction type.", "#FF0000", "Error", false);
  } catch (error) {
    console.error("Error handling hybrid menu interaction:", error);
    return sendEphemeralEmbed(interaction, "❌ An error occurred while processing your request.", "#FF0000", "Error", false);
  }
}

/**
 * Sends the main dashboard embed and components to the user.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 */
async function sendMainDashboard(interaction) {
  try {
    const embed = new EmbedBuilder()
        .setTitle("Bot Dashboard")
        .setDescription("Welcome to the bot dashboard! Use the buttons below to manage different features.")
        .setColor("#5865F2");

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("dash:reaction-roles")
            .setLabel("Reaction Roles")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("🎭"),
        new ButtonBuilder()
            .setCustomId("dash:info-menus")
            .setLabel("Information Menus")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("📋"),
        new ButtonBuilder()
            .setCustomId("dash:hybrid-menus")
            .setLabel("Hybrid Menus")
            .setStyle(ButtonStyle.Success)
            .setEmoji("🔀"),
        new ButtonBuilder()
            .setCustomId("dash:scheduled-messages")
            .setLabel("Scheduled Messages")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("⏰"),
        new ButtonBuilder()
            .setCustomId("dash:performance")
            .setLabel("Performance")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("📊")
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("dash:dynamic-content")
            .setLabel("Dynamic Content")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔮")
    );
    
    await interaction.editReply({ embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error("Error in sendMainDashboard:", error);
    throw error; // Re-throw to be caught by the caller
  }
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
        value: `Member Counts: ${(() => {
          const options = menu.memberCountOptions || {};
          const legacy = menu.showMemberCounts;
          
          if (options.showInDropdowns && options.showInButtons) {
            return "✅ Dropdowns & Buttons";
          } else if (options.showInDropdowns) {
            return "✅ Dropdowns Only";
          } else if (options.showInButtons) {
            return "✅ Buttons Only";
          } else if (legacy && !options.showInDropdowns && !options.showInButtons) {
            return "✅ Enabled (Legacy)";
          } else {
            return "❌ Hidden";
          }
        })()}\n` +
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
        .setLabel("Button Colors (Bulk)")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!menu.buttonRoles.length),
      new ButtonBuilder()
        .setCustomId(`rr:simple_button_colors:${menuId}`)
        .setLabel("Simple Button Colors")
        .setStyle(ButtonStyle.Secondary)
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
        .setLabel("Configure Counts")
        .setStyle(ButtonStyle.Secondary)
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
                const webhookName = menu.webhookName || "Reaction Role Webhook";
                const webhook = await getOrCreateWebhook(channel, webhookName);
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

// ======================= Information Menu Functions =======================

/**
 * Shows page creation options with templates and custom creation
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} infoMenuId - The ID of the info menu.
 */
async function showPageCreationOptions(interaction, infoMenuId) {
  const menu = db.getInfoMenu(infoMenuId);
  if (!menu) {
    return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
  }

  const embed = new EmbedBuilder()
    .setTitle(`📝 Create New Page: ${menu.name}`)
    .setDescription(`Choose how you'd like to create your new page:\n\n🎨 **Templates** - Quick-start with pre-made layouts\n⚙️ **Custom** - Build from scratch with full control`)
    .setColor("#5865F2");

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`info:add_page_template:${infoMenuId}:rules`)
      .setLabel("📋 Server Rules")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`info:add_page_template:${infoMenuId}:faq`)
      .setLabel("❓ FAQ")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`info:add_page_template:${infoMenuId}:guide`)
      .setLabel("📖 Guide")
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`info:add_page_template:${infoMenuId}:links`)
      .setLabel("🔗 Important Links")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`info:add_page_template:${infoMenuId}:contact`)
      .setLabel("📞 Contact Info")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`info:add_page_custom:${infoMenuId}`)
      .setLabel("⚙️ Custom Page")
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`info:back_to_config:${infoMenuId}`)
      .setLabel("Back to Menu Config")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️")
  );

  const responseData = {
    embeds: [embed],
    components: [row1, row2, row3],
    flags: MessageFlags.Ephemeral
  };

  return interaction.deferred || interaction.replied ? 
    interaction.editReply(responseData) : 
    interaction.reply(responseData);
}

/**
 * Creates a page from a predefined template
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} infoMenuId - The ID of the info menu.
 * @param {string} templateType - The type of template to use.
 */
async function createPageFromTemplate(interaction, infoMenuId, templateType) {
  const templates = {
    rules: {
      name: "Server Rules",
      title: "📋 Server Rules",
      description: "**Please follow these rules to maintain a positive environment:**\n\n1️⃣ **Be Respectful** - Treat all members with kindness and respect\n2️⃣ **No Spam** - Keep conversations relevant and avoid excessive posting\n3️⃣ **No NSFW Content** - Keep all content appropriate for all ages\n4️⃣ **Use Appropriate Channels** - Post content in the correct channels\n5️⃣ **Follow Discord ToS** - All Discord Terms of Service apply\n\n*Violations may result in warnings, mutes, or bans depending on severity.*",
      color: "#FF6B6B",
      emoji: "📋",
      category: "Rules & Guidelines"
    },
    faq: {
      name: "Frequently Asked Questions",
      title: "❓ FAQ",
      description: "**Common questions and answers:**\n\n**Q: How do I get roles?**\nA: Use the reaction role menus or ask a moderator.\n\n**Q: Can I invite friends?**\nA: Yes! Use our invite link in the info channel.\n\n**Q: Who do I contact for help?**\nA: Ping @Moderators or create a support ticket.\n\n**Q: What are the server rules?**\nA: Check out our rules page for full details.\n\n*Have another question? Ask in #general!*",
      color: "#4ECDC4",
      emoji: "❓",
      category: "Information"
    },
    guide: {
      name: "Server Guide",
      title: "📖 Getting Started Guide",
      description: "**Welcome to our server! Here's how to get started:**\n\n🔸 **Step 1:** Read the rules and guidelines\n🔸 **Step 2:** Get your roles using the reaction menus\n🔸 **Step 3:** Introduce yourself in #introductions\n🔸 **Step 4:** Explore the different channels\n🔸 **Step 5:** Join conversations and have fun!\n\n**Need help?** Our moderators are always ready to assist you. Don't hesitate to ask questions!",
      color: "#45B7D1",
      emoji: "📖",
      category: "Getting Started"
    },
    links: {
      name: "Important Links",
      title: "🔗 Important Links",
      description: "**Quick access to important resources:**\n\n🌐 **Website:** [Your Website](https://example.com)\n📺 **YouTube:** [Your Channel](https://youtube.com)\n🐦 **Twitter:** [@YourHandle](https://twitter.com)\n💬 **Discord Invite:** [Invite Link](https://discord.gg/invite)\n📧 **Contact Email:** your@email.com\n\n*Bookmark these for easy access!*",
      color: "#9B59B6",
      emoji: "🔗",
      category: "Resources"
    },
    contact: {
      name: "Contact Information",
      title: "📞 Contact & Support",
      description: "**Need help or have questions?**\n\n👑 **Server Owner:** @ServerOwner\n🛡️ **Moderators:** @Moderators\n🎫 **Support Tickets:** Use the ticket system\n📧 **Email:** support@yourserver.com\n\n**Response Times:**\n• Discord: Usually within a few hours\n• Email: 24-48 hours\n• Tickets: Priority support\n\n*We're here to help make your experience great!*",
      color: "#E67E22",
      emoji: "📞",
      category: "Support"
    }
  };

  const template = templates[templateType];
  if (!template) {
    return sendEphemeralEmbed(interaction, "❌ Invalid template type.", "#FF0000", "Error", false);
  }

  // Create page with template data
  const pageId = `page_${Date.now()}`;
  const newPage = {
    id: pageId,
    name: template.name,
    content: {
      title: template.title,
      description: template.description,
      color: template.color
    },
    displayIn: ['dropdown', 'button'], // Default to both
    emoji: template.emoji,
    category: template.category,
    order: Date.now(), // Use timestamp for ordering
    createdAt: new Date().toISOString()
  };

  try {
    await db.saveInfoMenuPage(infoMenuId, newPage);
    await sendEphemeralEmbed(interaction, `✅ Created "${template.name}" page successfully!`, "#00FF00", "Success", false);
    return showInfoMenuConfiguration(interaction, infoMenuId);
  } catch (error) {
    console.error("Error creating page from template:", error);
    return sendEphemeralEmbed(interaction, `❌ Failed to create page: ${error.message}`, "#FF0000", "Error", false);
  }
}

/**
 * Displays the information menus dashboard, listing existing menus and providing options to create/configure.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 */
/**
 * Shows the page management interface for an information menu.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} infoMenuId - The ID of the info menu.
 */
async function showInfoMenuPageManagement(interaction, infoMenuId) {
  const menu = db.getInfoMenu(infoMenuId);
  if (!menu) {
    const errorMessage = {
      content: "❌ Information menu not found.",
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral
    };
    return interaction.deferred || interaction.replied ? 
      interaction.editReply(errorMessage) : 
      interaction.reply(errorMessage);
  }

  const pages = db.getInfoMenuPages(infoMenuId);
  
  const embed = new EmbedBuilder()
    .setTitle(`📄 Page Management: ${menu.name}`)
    .setDescription(`Manage pages for your information menu.\n\n**Total Pages:** ${pages.length}`)
    .setColor("#5865F2");

  if (pages.length > 0) {
    const pageList = pages.slice(0, 10).map((page, index) => {
      const truncatedContent = page.content.description 
        ? (page.content.description.length > 50 
           ? page.content.description.substring(0, 47) + "..." 
           : page.content.description)
        : "No description";
      return `**${index + 1}.** ${page.name}\n   *${truncatedContent}*`;
    }).join('\n\n');

    embed.addFields([
      { 
        name: "📚 Current Pages", 
        value: pageList + (pages.length > 10 ? `\n\n*...and ${pages.length - 10} more pages*` : ""), 
        inline: false 
      }
    ]);
  } else {
    embed.addFields([
      { name: "📚 Current Pages", value: "*No pages yet. Add your first page!*", inline: false }
    ]);
  }

  const components = [];

  // Page management buttons
  const managementRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`info:add_page:${infoMenuId}`)
      .setLabel("Add New Page")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕"),
    new ButtonBuilder()
      .setCustomId(`info:reorder_pages:${infoMenuId}`)
      .setLabel("Reorder Pages")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages.length < 2)
  );

  components.push(managementRow);

  // If there are pages, add edit/delete dropdown
  if (pages.length > 0) {
    const pageOptions = pages.slice(0, 25).map(page => ({
      label: `Edit: ${page.name}`.substring(0, 100),
      value: `edit:${page.id}`,
      description: page.content.description ? page.content.description.substring(0, 100) : undefined,
      emoji: "✏️"
    }));

    // Add delete options
    pageOptions.push(...pages.slice(0, 25 - pageOptions.length).map(page => ({
      label: `Delete: ${page.name}`.substring(0, 100),
      value: `delete:${page.id}`,
      description: "⚠️ Permanently remove this page",
      emoji: "🗑️"
    })));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`info:page_action:${infoMenuId}`)
      .setPlaceholder("Select a page to edit or delete...")
      .addOptions(pageOptions.slice(0, 25));

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Back button
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`info:back_to_config:${infoMenuId}`)
      .setLabel("Back to Menu Config")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️")
  );

  components.push(backRow);

  const responseData = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  return interaction.deferred || interaction.replied ? 
    interaction.editReply(responseData) : 
    interaction.reply(responseData);
}

/**
 * Shows the page display configuration interface for an information menu.
 * Allows users to control which pages appear in dropdown vs buttons.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} infoMenuId - The ID of the info menu.
 */
async function showPageDisplayConfiguration(interaction, infoMenuId) {
  const menu = db.getInfoMenu(infoMenuId);
  if (!menu) {
    const errorMessage = {
      content: "❌ Information menu not found.",
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral
    };
    return interaction.deferred || interaction.replied ? 
      interaction.editReply(errorMessage) : 
      interaction.reply(errorMessage);
  }

  const pages = db.getInfoMenuPages(infoMenuId);
  
  if (pages.length === 0) {
    const errorMessage = {
      content: "❌ No pages found. Add some pages first!",
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral
    };
    return interaction.deferred || interaction.replied ? 
      interaction.editReply(errorMessage) : 
      interaction.reply(errorMessage);
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎛️ Page Display Settings: ${menu.name}`)
    .setDescription(`Configure where each page appears when published.\n\n📋 **Dropdown** - Appears in the select menu\n🔘 **Button** - Appears as a direct button\n📋🔘 **Both** - Appears in both dropdown and buttons\n❌ **Hidden** - Page exists but won't be shown\n\n**Click the buttons below to toggle each page:**`)
    .setColor("#5865F2");

  const components = [];
  
  // Create buttons for each page showing current state
  const pageButtons = pages.slice(0, 20).map(page => { // Limit to 20 pages to fit in 4 rows
    const displayIn = page.displayIn || ['dropdown', 'button'];
    
    let displayEmoji = "📋🔘";
    let style = ButtonStyle.Primary;
    
    if (Array.isArray(displayIn)) {
      if (displayIn.includes('dropdown') && !displayIn.includes('button')) {
        displayEmoji = "📋";
        style = ButtonStyle.Success;
      } else if (displayIn.includes('button') && !displayIn.includes('dropdown')) {
        displayEmoji = "🔘";
        style = ButtonStyle.Secondary;
      } else if (displayIn.length === 0) {
        displayEmoji = "❌";
        style = ButtonStyle.Danger;
      }
    }
    
    // Use page emoji if available, otherwise use display type emoji
    const buttonEmoji = page.emoji || displayEmoji;
    
    return new ButtonBuilder()
      .setCustomId(`info:cycle_display:${infoMenuId}:${page.id}`)
      .setLabel(`${page.name}`.substring(0, 80))
      .setEmoji(buttonEmoji)
      .setStyle(style);
  });

  // Split buttons into rows of 5
  for (let i = 0; i < pageButtons.length; i += 5) {
    const row = new ActionRowBuilder().addComponents(pageButtons.slice(i, i + 5));
    components.push(row);
  }

  // Add navigation buttons
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`info:back_to_config:${infoMenuId}`)
      .setLabel("Back to Menu Config")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️")
  );

  components.push(navRow);

  const responseData = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  return interaction.deferred || interaction.replied ? 
    interaction.editReply(responseData) : 
    interaction.reply(responseData);
}

/**
 * Publishes an information menu to a channel or edits an existing published message.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} infoMenuId - The ID of the info menu to publish.
 * @param {import('discord.js').Message} [existingMessage] - Existing message to edit (optional).
 */
async function publishInfoMenu(interaction, infoMenuId, existingMessage = null) {
  try {
    const menu = db.getInfoMenu(infoMenuId);
    if (!menu) {
      return sendEphemeralEmbed(interaction, "❌ Information menu not found.", "#FF0000", "Error", false);
    }

    const pages = db.getInfoMenuPages(infoMenuId);
    if (!pages || pages.length === 0) {
      return sendEphemeralEmbed(interaction, "❌ No pages found for this menu. Add some pages first!", "#FF0000", "Error", false);
    }

    // Process dynamic content for menu title and description
    const processedTitle = processDynamicContent(menu.name, interaction);
    const processedDescription = processDynamicContent(menu.desc, interaction);

    // Create the main embed with dynamic content
    const embed = new EmbedBuilder()
      .setTitle(processedTitle)
      .setDescription(processedDescription)
      .setColor(menu.embedColor || "#5865F2");

    if (menu.embedThumbnail) embed.setThumbnail(menu.embedThumbnail);
    if (menu.embedImage) embed.setImage(menu.embedImage);
    
    if (menu.embedAuthorName) {
      embed.setAuthor({
        name: processDynamicContent(menu.embedAuthorName, interaction),
        iconURL: menu.embedAuthorIconURL
      });
    }

    if (menu.embedFooterText) {
      embed.setFooter({
        text: menu.embedFooterText,
        iconURL: menu.embedFooterIconURL
      });
    }

    // Create interaction components based on selection type
    const components = [];
    const selectionTypes = Array.isArray(menu.selectionType) ? menu.selectionType : 
                          (menu.selectionType ? [menu.selectionType] : []);

    if (selectionTypes.includes("dropdown")) {
      // Filter pages that should appear in dropdown
      const dropdownPages = pages.filter(page => {
        const displayIn = page.displayIn || ['dropdown', 'button']; // Default to both for backward compatibility
        return Array.isArray(displayIn) ? displayIn.includes('dropdown') : displayIn === 'dropdown';
      });

      if (dropdownPages.length > 0) {
        const pageOptions = dropdownPages.slice(0, 25).map(page => ({
          label: page.name.substring(0, 100),
          value: page.id,
          description: page.dropdownDescription || (page.content.description ? page.content.description.substring(0, 100) : undefined),
          emoji: page.emoji || '📄'
        }));

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`info-menu-select:${infoMenuId}`)
          .setPlaceholder(menu.dropdownPlaceholder || "📚 Select a page to view...")
          .addOptions(pageOptions);

        components.push(new ActionRowBuilder().addComponents(selectMenu));
      }
    }

    if (selectionTypes.includes("button")) {
      // Filter pages that should appear as buttons
      const buttonPages = pages.filter(page => {
        const displayIn = page.displayIn || ['dropdown', 'button']; // Default to both for backward compatibility
        return Array.isArray(displayIn) ? displayIn.includes('button') : displayIn === 'button';
      });

      if (buttonPages.length > 0) {
        // Create buttons for pages (max 25 buttons across 5 rows)
        const maxButtons = Math.min(buttonPages.length, 25);
        let currentRow = new ActionRowBuilder();
        let buttonsInRow = 0;
        let rowCount = 0;

        // If dropdown is already taking a row, we have 4 rows left for buttons
        const maxRows = selectionTypes.includes("dropdown") ? 4 : 5;

        for (let i = 0; i < maxButtons; i++) {
          const page = buttonPages[i];
          const buttonStyle = page.buttonColor || 'Secondary'; // Use buttonColor instead of buttonStyle
          const button = new ButtonBuilder()
            .setCustomId(`info-page:${infoMenuId}:${page.id}`)
            .setLabel(page.name.substring(0, 80))
            .setStyle(ButtonStyle[buttonStyle]);

          // Add emoji if page has one
          if (page.emoji) {
            button.setEmoji(page.emoji);
          }

          currentRow.addComponents(button);
          buttonsInRow++;

          // Start new row after 5 buttons or if it's the last button
          if (buttonsInRow === 5 || i === maxButtons - 1) {
            components.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonsInRow = 0;
            rowCount++;
            
            if (rowCount >= maxRows) break; // Discord limit
          }
        }
      }
    }

    const messagePayload = {
      embeds: [embed],
      components: components
    };

    if (existingMessage) {
      // Edit existing message
      await existingMessage.edit(messagePayload);
      await sendEphemeralEmbed(interaction, `✅ Information menu "${menu.name}" updated successfully!`, "#00FF00", "Success", false);
    } else {
      // Show channel selection modal
      const modal = new ModalBuilder()
        .setCustomId(`info:modal:publish_channel:${infoMenuId}`)
        .setTitle("Publish Information Menu")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("channel_id")
              .setLabel("Channel ID or #channel")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("123456789012345678 or #general")
          )
        );

      try {
        return await interaction.showModal(modal);
      } catch (modalError) {
        console.error("Error showing publish modal:", modalError);
        return sendEphemeralEmbed(interaction, "❌ Failed to show channel selection modal. Please try again.", "#FF0000", "Error", false);
      }
    }
  } catch (error) {
    console.error("Error in publishInfoMenu:", error);
    return sendEphemeralEmbed(interaction, `❌ Failed to publish menu: ${error.message}`, "#FF0000", "Error", false);
  }
}

async function showInfoMenusDashboard(interaction) {
  const infoMenus = db.getInfoMenus(interaction.guild.id);

  const embed = new EmbedBuilder()
      .setTitle("Information Menus")
      .setDescription("Manage your information menus here. Create flexible display systems for rules, FAQs, guides, and more!")
      .setColor("#5865F2");

  const components = [];

  if (infoMenus.length > 0) {
      const menuOptions = infoMenus.slice(0, 25).map((menu) => ({ 
          label: menu.name.substring(0, 100), 
          value: menu.id,
          description: menu.desc ? menu.desc.substring(0, 100) : undefined
      }));
      const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("info:selectmenu")
          .setPlaceholder("Select a menu to configure...")
          .addOptions(menuOptions);
      components.push(new ActionRowBuilder().addComponents(selectMenu));
  } else {
      embed.setDescription("No information menus found. Create a new one to get started! Perfect for rules, FAQs, guides, and more.");
  }

  const createButton = new ButtonBuilder()
      .setCustomId("info:create")
      .setLabel("Create New Menu")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕");

  const templateButton = new ButtonBuilder()
      .setCustomId("info:browse_templates")
      .setLabel("Create from Template")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📋");

  const rawJsonButton = new ButtonBuilder()
      .setCustomId("info:create_from_json")
      .setLabel("Create from JSON")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📄");

  const backButton = new ButtonBuilder()
      .setCustomId("dash:back")
      .setLabel("Back to Dashboard")
      .setStyle(ButtonStyle.Secondary);

  components.push(new ActionRowBuilder().addComponents(createButton, templateButton, rawJsonButton));
  components.push(new ActionRowBuilder().addComponents(backButton));

  console.log(`[Debug] Info Menu Dashboard components: ${components.length} rows`);

  try {
      await interaction.editReply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  } catch (error) {
      console.error("Error displaying information menus dashboard:", error);
      await interaction.editReply({ content: "❌ Something went wrong while displaying the information menus dashboard.", flags: MessageFlags.Ephemeral });
  }
}

async function showHybridMenusDashboard(interaction) {
  const hybridMenus = db.getHybridMenus(interaction.guild.id);

  const embed = new EmbedBuilder()
      .setTitle("🔀 Hybrid Menus")
      .setDescription("Manage hybrid menus that combine both information pages AND reaction roles in one unified interface!")
      .setColor("#00D084")
      .addFields(
          { name: "📋 Information Pages", value: "Display rules, guides, FAQs, and other content", inline: true },
          { name: "🎭 Reaction Roles", value: "Let users assign/remove roles", inline: true },
          { name: "🔀 Combined Power", value: "Both features in one message!", inline: true }
      );

  const components = [];

  if (hybridMenus.length > 0) {
      const menuOptions = hybridMenus.slice(0, 25).map((menu) => ({ 
          label: menu.name.substring(0, 100), 
          value: menu.id,
          description: menu.desc ? menu.desc.substring(0, 100) : undefined
      }));
      const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("hybrid:selectmenu")
          .setPlaceholder("Select a hybrid menu to configure...")
          .addOptions(menuOptions);
      components.push(new ActionRowBuilder().addComponents(selectMenu));
  } else {
      embed.setDescription("No hybrid menus found. Create your first hybrid menu to combine information display with role management!\n\n**Example Use Cases:**\n• Server rules with punishment roles\n• Game guides with game-specific roles\n• FAQ with helper roles\n• Announcements with notification roles");
  }

  const createButton = new ButtonBuilder()
      .setCustomId("hybrid:create")
      .setLabel("Create Hybrid Menu")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🔀");

  const createFromJsonButton = new ButtonBuilder()
      .setCustomId("hybrid:create_from_json")
      .setLabel("Create from Raw JSON")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📄");

  const backButton = new ButtonBuilder()
      .setCustomId("dash:back")
      .setLabel("Back to Dashboard")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️");

  const buttonRow = new ActionRowBuilder().addComponents(createButton, createFromJsonButton, backButton);
  components.push(buttonRow);

  try {
      await interaction.editReply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  } catch (error) {
      console.error("Error displaying hybrid menus dashboard:", error);
      await interaction.editReply({ content: "❌ Something went wrong while displaying the hybrid menus dashboard.", flags: MessageFlags.Ephemeral });
  }
}

async function showHybridMenuConfiguration(interaction, hybridMenuId) {
  const menu = db.getHybridMenu(hybridMenuId);
  if (!menu) {
    return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
  }

  const embed = new EmbedBuilder()
    .setTitle(`🔀 Hybrid Menu: ${menu.name}`)
    .setDescription(`**Description:** ${menu.desc}\n\n**Configuration Status:**`)
    .setColor("#00D084")
    .addFields([
      { 
        name: "📋 Information Pages", 
        value: (() => {
          const pages = menu.pages || [];
          if (pages.length === 0) return "No pages configured";
          
          const dropdownCount = pages.filter(p => p.displayType === 'dropdown').length;
          const buttonCount = pages.filter(p => p.displayType === 'button').length;
          
          return `${pages.length} pages total\n📋 ${dropdownCount} dropdown, 🔘 ${buttonCount} button`;
        })(), 
        inline: true 
      },
      { 
        name: "🎭 Reaction Roles", 
        value: `${(menu.dropdownRoles?.length || 0)} dropdown roles\n${(menu.buttonRoles?.length || 0)} button roles`, 
        inline: true 
      },
      { 
        name: "📊 Status", 
        value: menu.channelId ? `Published in <#${menu.channelId}>` : "Not published", 
        inline: true 
      },
      {
        name: "🌐 Webhook",
        value: menu.useWebhook ? "✅ Enabled" : "❌ Disabled",
        inline: true
      },
      {
        name: "🏷️ Branding",
        value: menu.useWebhook
          ? (menu.webhookName
            ? `Name: ${menu.webhookName}\n${menu.webhookAvatar ? "Custom Avatar" : "Default Avatar"}`
            : "Not configured")
          : "N/A (Webhook Disabled)",
        inline: true
      },
      {
        name: "📊 Member Counts",
        value: (() => {
          const options = menu.memberCountOptions || {};
          const legacy = menu.showMemberCounts;
          
          if (options.showInDropdowns && options.showInButtons) {
            return "✅ Shown in dropdowns and buttons";
          } else if (options.showInDropdowns) {
            return "✅ Shown in dropdowns only";
          } else if (options.showInButtons) {
            return "✅ Shown in buttons only";
          } else if (legacy && !options.showInDropdowns && !options.showInButtons) {
            return "✅ Enabled (legacy setting)";
          } else {
            return "❌ Hidden";
          }
        })(),
        inline: true
      }
    ]);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:config_info:${hybridMenuId}`)
      .setLabel("Configure Info Pages")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📋"),
    new ButtonBuilder()
      .setCustomId(`hybrid:config_roles:${hybridMenuId}`)
      .setLabel("Configure Roles")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎭"),
    new ButtonBuilder()
      .setCustomId(`hybrid:customize_embed:${hybridMenuId}`)
      .setLabel("Customize Embed")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🎨")
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:component_order:${hybridMenuId}`)
      .setLabel("Component Order")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📑"),
    new ButtonBuilder()
      .setCustomId(`hybrid:customize_dropdown_text:${hybridMenuId}`)
      .setLabel("Customize Dropdown Text")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("💬"),
    new ButtonBuilder()
      .setCustomId(`hybrid:webhook_branding:${hybridMenuId}`)
      .setLabel("Webhook Branding")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🏷️")
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:toggle_webhook:${hybridMenuId}`)
      .setLabel(menu.useWebhook ? "Disable Webhook" : "Enable Webhook")
      .setStyle(menu.useWebhook ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji("🌐"),
    new ButtonBuilder()
      .setCustomId(`hybrid:toggle_member_counts:${hybridMenuId}`)
      .setLabel("Configure Counts")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📊"),
    new ButtonBuilder()
      .setCustomId(`hybrid:publish:${hybridMenuId}`)
      .setLabel("Publish Menu")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🚀"),
    new ButtonBuilder()
      .setCustomId(`hybrid:preview:${hybridMenuId}`)
      .setLabel("Preview")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("👀")
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dash:hybrid-menus")
      .setLabel("Back to Dashboard")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️")
  );

  const components = [row1, row2, row3, row4];

  try {
    const responseData = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(responseData);
    } else {
      await interaction.reply(responseData);
    }
  } catch (error) {
    console.error("Error displaying hybrid menu configuration:", error);
    
    const errorData = { content: "❌ Something went wrong while displaying the hybrid menu configuration.", flags: MessageFlags.Ephemeral };
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorData);
      } else {
        await interaction.reply(errorData);
      }
    } catch (replyError) {
      console.error("Failed to send error response:", replyError);
    }
  }
}

// Publish info menu to specific channel (for scheduled messages)
async function publishInfoMenuToChannel(menu, channel, mockInteraction) {
  try {
    const pages = db.getInfoMenuPages(menu.id);
    if (!pages || pages.length === 0) {
      console.error("No pages found for scheduled menu:", menu.id);
      return;
    }

    // Process dynamic content for menu title and description
    const processedTitle = processDynamicContent(menu.name, mockInteraction);
    const processedDescription = processDynamicContent(menu.desc, mockInteraction);

    // Create the main embed with dynamic content
    const embed = new EmbedBuilder()
      .setTitle(processedTitle)
      .setDescription(processedDescription)
      .setColor(menu.embedColor || "#5865F2");

    if (menu.embedThumbnail) embed.setThumbnail(menu.embedThumbnail);
    if (menu.embedImage) embed.setImage(menu.embedImage);
    
    if (menu.embedAuthorName) {
      embed.setAuthor({
        name: processDynamicContent(menu.embedAuthorName, mockInteraction),
        iconURL: menu.embedAuthorIconURL
      });
    }

    if (menu.embedFooterText) {
      embed.setFooter({
        text: processDynamicContent(menu.embedFooterText, mockInteraction),
        iconURL: menu.embedFooterIconURL
      });
    }

    // Create components (simplified for scheduled messages)
    const components = [];
    
    // Add dropdown if enabled
    if (Array.isArray(menu.selectionType) && menu.selectionType.includes("dropdown") || menu.selectionType === "dropdown") {
      const dropdownPages = pages.filter(page => {
        const displayIn = page.displayIn || ['dropdown', 'button'];
        return Array.isArray(displayIn) ? displayIn.includes('dropdown') : displayIn === 'dropdown';
      });
      
      if (dropdownPages.length > 0) {
        const options = dropdownPages.slice(0, 25).map(page => ({
          label: page.name,
          value: `info-page:${menu.id}:${page.id}`,
          description: page.dropdownDescription || page.desc?.substring(0, 50) || 'No description',
          emoji: page.emoji || '📋'
        }));
        
        const dropdown = new StringSelectMenuBuilder()
          .setCustomId(`info-menu:${menu.id}`)
          .setPlaceholder(menu.dropdownPlaceholder || 'Select an option...')
          .addOptions(options);
        
        components.push(new ActionRowBuilder().addComponents(dropdown));
      }
    }

    // Add buttons if enabled
    if (Array.isArray(menu.selectionType) && menu.selectionType.includes("button") || menu.selectionType === "button") {
      const buttonPages = pages.filter(page => {
        const displayIn = page.displayIn || ['dropdown', 'button'];
        return Array.isArray(displayIn) ? displayIn.includes('button') : displayIn === 'button';
      });
      
      if (buttonPages.length > 0) {
        const buttonRows = [];
        let currentRow = new ActionRowBuilder();
        let buttonsInRow = 0;
        
        buttonPages.forEach(page => {
          if (buttonsInRow >= 5) {
            buttonRows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonsInRow = 0;
          }
          
          const button = new ButtonBuilder()
            .setCustomId(`info-page:${menu.id}:${page.id}`)
            .setLabel(page.name)
            .setStyle(ButtonStyle[page.buttonColor] || ButtonStyle.Primary);
          
          if (page.emoji) button.setEmoji(page.emoji);
          
          currentRow.addComponents(button);
          buttonsInRow++;
        });
        
        if (buttonsInRow > 0) {
          buttonRows.push(currentRow);
        }
        
        components.push(...buttonRows);
      }
    }

    // Send the message
    await channel.send({ embeds: [embed], components });
    
  } catch (error) {
    console.error("Error publishing scheduled info menu:", error);
  }
}

/**
 * Displays the configuration options for a specific information menu.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} infoMenuId - The ID of the info menu to configure.
 */
async function showInfoMenuConfiguration(interaction, infoMenuId) {
    if (!infoMenuId || typeof infoMenuId !== 'string' || infoMenuId.length < 5) {
      console.error(`Invalid infoMenuId provided to showInfoMenuConfiguration: ${infoMenuId}`);
      const errorMessage = {
        content: "❌ Invalid menu configuration. Please recreate the menu or select a valid one from the dashboard.",
        flags: MessageFlags.Ephemeral
      };
      return interaction.deferred || interaction.replied ? 
        interaction.editReply(errorMessage) : 
        interaction.reply(errorMessage);
    }

    const menu = db.getInfoMenu(infoMenuId);
    if (!menu) {
      console.error(`Info menu not found for ID: ${infoMenuId}`);
      const errorMessage = {
        content: "Information menu not found. It might have been deleted.",
        flags: MessageFlags.Ephemeral
      };
      return interaction.deferred || interaction.replied ? 
        interaction.editReply(errorMessage) : 
        interaction.reply(errorMessage);
    }

    const embed = new EmbedBuilder()
      .setTitle(`Configuring: ${menu.name}`)
      .setDescription(menu.desc)
      .addFields(
        { name: "Menu ID", value: `\`${infoMenuId}\``, inline: true },
        { name: "Selection Type", value: Array.isArray(menu.selectionType) ? menu.selectionType.join(" + ") || "None set" : (menu.selectionType || "None set"), inline: true },
        { name: "Published", value: menu.messageId ? `✅ Yes in <#${menu.channelId}>` : "❌ No", inline: true },
      )
      .setColor(menu.embedColor || "#5865F2");

    // Add page display breakdown
    if (menu.pages.length > 0) {
      const pages = menu.pages;
      
      // Count pages by display type
      const dropdownPages = pages.filter(page => {
        const displayIn = page.displayIn || ['dropdown', 'button'];
        return Array.isArray(displayIn) ? displayIn.includes('dropdown') : displayIn === 'dropdown';
      });
      
      const buttonPages = pages.filter(page => {
        const displayIn = page.displayIn || ['dropdown', 'button'];
        return Array.isArray(displayIn) ? displayIn.includes('button') : displayIn === 'button';
      });

      const hiddenPages = pages.filter(page => {
        const displayIn = page.displayIn || ['dropdown', 'button'];
        return Array.isArray(displayIn) ? displayIn.length === 0 : false;
      });

      embed.addFields([
        { 
          name: "📊 Page Summary", 
          value: `**Total:** ${pages.length} pages\n📋 **Dropdown:** ${dropdownPages.length}\n🔘 **Button:** ${buttonPages.length}\n❌ **Hidden:** ${hiddenPages.length}`, 
          inline: true 
        },
        { 
          name: "📚 Recent Pages", 
          value: pages.length > 0 ? pages.slice(0, 5).map((page, index) => {
            const displayIn = page.displayIn || ['dropdown', 'button'];
            let icon = "📋🔘";
            if (Array.isArray(displayIn)) {
              if (displayIn.includes('dropdown') && !displayIn.includes('button')) icon = "📋";
              else if (displayIn.includes('button') && !displayIn.includes('dropdown')) icon = "🔘";
              else if (displayIn.length === 0) icon = "❌";
            }
            return `${icon} ${page.name}`;
          }).join("\n") + (pages.length > 5 ? `\n*...and ${pages.length - 5} more*` : "") : "None", 
          inline: true 
        }
      ]);
    } else {
      embed.addFields([
        { name: "📚 Pages", value: "No pages yet. Add your first page!", inline: false }
      ]);
    }

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
        name: "Template Status",
        value: menu.isTemplate ? `✅ "${menu.templateName}"` : "❌ Not a template",
        inline: true
      }
    );

    const row_publish_delete = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`info:publish:${infoMenuId}`)
        .setLabel("Publish Menu")
        .setStyle(ButtonStyle.Success)
        .setDisabled(menu.pages.length === 0 || (!Array.isArray(menu.selectionType) && !menu.selectionType) || (Array.isArray(menu.selectionType) && menu.selectionType.length === 0)),
      new ButtonBuilder()
        .setCustomId(`info:edit_published:${infoMenuId}`)
        .setLabel("Update Published Menu")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!menu.messageId),
      new ButtonBuilder()
        .setCustomId(`info:delete_published:${infoMenuId}`)
        .setLabel("Delete Published Message")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!menu.messageId),
      new ButtonBuilder()
        .setCustomId(`info:delete_menu:${infoMenuId}`)
        .setLabel("Delete This Menu")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("dash:info-menus")
        .setLabel("Back to Info Dashboard")
        .setStyle(ButtonStyle.Secondary)
    );

    const row_selection_and_pages = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`info:toggle_type:dropdown:${infoMenuId}`)
        .setLabel(Array.isArray(menu.selectionType) && menu.selectionType.includes("dropdown") || menu.selectionType === "dropdown" ? "Disable Dropdown" : "Enable Dropdown")
        .setStyle(Array.isArray(menu.selectionType) && menu.selectionType.includes("dropdown") || menu.selectionType === "dropdown" ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`info:toggle_type:button:${infoMenuId}`)
        .setLabel(Array.isArray(menu.selectionType) && menu.selectionType.includes("button") || menu.selectionType === "button" ? "Disable Buttons" : "Enable Buttons")
        .setStyle(Array.isArray(menu.selectionType) && menu.selectionType.includes("button") || menu.selectionType === "button" ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`info:manage_pages:${infoMenuId}`)
        .setLabel("Manage Pages")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`info:add_page:${infoMenuId}`)
        .setLabel("Add New Page")
        .setStyle(ButtonStyle.Success)
        .setEmoji("➕")
    );

    const row_customization = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`info:reorder_pages:${infoMenuId}`)
        .setLabel("Reorder Pages")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(menu.pages.length <= 1),
      new ButtonBuilder()
        .setCustomId(`info:customize_embed:${infoMenuId}`)
        .setLabel("Customize Embed")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`info:customize_footer:${infoMenuId}`)
        .setLabel("Customize Footer")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`info:configure_button_colors:${infoMenuId}`)
        .setLabel("Configure Button Colors")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎨")
        .setDisabled(menu.pages.length === 0),
      new ButtonBuilder()
        .setCustomId(`info:page_descriptions:${infoMenuId}`)
        .setLabel("Set Page Descriptions")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📝")
        .setDisabled(menu.pages.length === 0)
    );

    const row_advanced = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`info:configure_page_emojis:${infoMenuId}`)
        .setLabel("Configure Page Emojis")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("😀")
        .setDisabled(menu.pages.length === 0),
      new ButtonBuilder()
        .setCustomId(`info:customize_dropdown_text:${infoMenuId}`)
        .setLabel("Customize Dropdown Text")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("💬"),
      new ButtonBuilder()
        .setCustomId(`info:toggle_webhook:${infoMenuId}`)
        .setLabel(menu.useWebhook ? "Disable Webhook" : "Enable Webhook")
        .setStyle(menu.useWebhook ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`info:config_webhook:${infoMenuId}`)
        .setLabel("Configure Webhook")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!menu.useWebhook),
      new ButtonBuilder()
        .setCustomId(`info:save_as_template:${infoMenuId}`)
        .setLabel("Save as Template")
        .setStyle(ButtonStyle.Secondary)
    );

    const row_utility = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`info:clone_menu:${infoMenuId}`)
        .setLabel("Clone Menu")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📋")
    );

    const finalComponents = [
      row_publish_delete,
      row_selection_and_pages,
      row_customization,
      row_advanced,
      row_utility
    ];

    console.log(`[Debug] Info Menu ${infoMenuId} components: ${finalComponents.length} rows`);

    try {
      const responseData = { embeds: [embed], components: finalComponents, flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(responseData);
      } else {
        await interaction.reply(responseData);
      }
    } catch (error) {
      console.error("Error displaying info menu configuration:", error);
      const errorMessage = { content: "❌ Something went wrong while displaying the info menu configuration.", flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
}

// Hybrid Menu Info Pages Configuration
async function showHybridInfoConfiguration(interaction, hybridMenuId, successMessage = null) {
  const menu = db.getHybridMenu(hybridMenuId);
  if (!menu) {
    return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
  }

  const pages = menu.pages || [];
  
  const embed = new EmbedBuilder()
    .setTitle(`📋 Info Pages: ${menu.name}`)
    .setDescription("Configure information pages for your hybrid menu. Each page can be displayed as a dropdown option or button.")
    .setColor("#5865F2")
    .addFields([
      { 
        name: "📄 Current Pages", 
        value: pages.length > 0 
          ? pages.map((page, index) => {
              const displayIcon = page.displayType === 'button' ? '🔘' : '📋';
              const displayText = page.displayType === 'button' ? 'Button' : 'Dropdown';
              return `${displayIcon} **${page.name}** (${displayText})`;
            }).join('\n')
          : "No pages configured yet", 
        inline: false 
      }
    ]);

  // Add success message if provided
  if (successMessage) {
    embed.setFooter({ text: successMessage });
    embed.setColor("#00FF00");
  }

  const components = [];

  // Add page buttons
  const addPageRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:add_info_page:${hybridMenuId}`)
      .setLabel("Add Page")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕"),
    new ButtonBuilder()
      .setCustomId(`hybrid:add_info_page_json:${hybridMenuId}`)
      .setLabel("Add Page from JSON")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📄")
  );
  components.push(addPageRow);

  // Page management if pages exist
  if (pages.length > 0) {
    const pageOptions = pages.slice(0, 25).map((page, index) => ({
      label: (page.name || page.title || 'Untitled Page').substring(0, 100),
      value: page.id,
      description: `Page ${index + 1}: ${(page.content || page.description || 'No content').substring(0, 50)}...`
    }));

    const pageSelectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`hybrid:manage_info_page:${hybridMenuId}`)
        .setPlaceholder("Select a page to edit or delete...")
        .addOptions(pageOptions)
    );
    components.push(pageSelectRow);
  }

  // Back button
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:back_to_config:${hybridMenuId}`)
      .setLabel("Back to Menu Config")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️")
  );
  components.push(backRow);

  try {
    const responseData = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(responseData);
    } else {
      await interaction.reply(responseData);
    }
  } catch (error) {
    console.error("Error displaying hybrid info configuration:", error);
    
    const errorData = { content: "❌ Something went wrong while displaying the info configuration.", flags: MessageFlags.Ephemeral };
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorData);
      } else {
        await interaction.reply(errorData);
      }
    } catch (err) {
      console.error("Error sending error message:", err);
    }
  }
}

// Hybrid Menu Roles Configuration
async function showHybridRolesConfiguration(interaction, hybridMenuId, successMessage = null) {
  const menu = db.getHybridMenu(hybridMenuId);
  if (!menu) {
    return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
  }

  const dropdownRoles = menu.dropdownRoles || [];
  const buttonRoles = menu.buttonRoles || [];
  const totalRoles = dropdownRoles.length + buttonRoles.length;
  
  const embed = new EmbedBuilder()
    .setTitle(`🎭 Reaction Roles: ${menu.name}`)
    .setDescription("Configure reaction roles for your hybrid menu. These will appear alongside information pages.")
    .setColor("#FF6B6B")
    .addFields([
      { 
        name: "📊 Current Roles", 
        value: totalRoles > 0 
          ? `Dropdown Roles: ${dropdownRoles.length}\nButton Roles: ${buttonRoles.length}\nTotal: ${totalRoles}`
          : "No roles configured yet", 
        inline: false 
      },
      { 
        name: "🎯 Display Options", 
        value: `Info Pages: ${menu.defaultInfoDisplayType || 'dropdown'}\nRoles: ${menu.defaultRoleDisplayType || 'dropdown'}`, 
        inline: true 
      }
    ]);

  // Add success message if provided
  if (successMessage) {
    embed.setFooter({ text: successMessage });
    embed.setColor("#00FF00");
  }

  const components = [];

  // Add role buttons
  const addRoleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:add_dropdown_role:${hybridMenuId}`)
      .setLabel("Add Dropdown Role")
      .setStyle(ButtonStyle.Success)
      .setEmoji("📝"),
    new ButtonBuilder()
      .setCustomId(`hybrid:add_button_role:${hybridMenuId}`)
      .setLabel("Add Button Role")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🔘")
  );
  components.push(addRoleRow);

  // Role management if roles exist
  if (totalRoles > 0) {
    const roleOptions = [];
    
    dropdownRoles.forEach(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (role) {
        roleOptions.push({
          label: `[Dropdown] ${role.name}`,
          value: `dropdown_${roleId}`,
          description: `Role ID: ${roleId}`
        });
      }
    });
    
    buttonRoles.forEach(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (role) {
        roleOptions.push({
          label: `[Button] ${role.name}`,
          value: `button_${roleId}`,
          description: `Role ID: ${roleId}`
        });
      }
    });

    if (roleOptions.length > 0) {
      const roleSelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`hybrid:manage_role:${hybridMenuId}`)
          .setPlaceholder("Select a role to edit or delete...")
          .addOptions(roleOptions.slice(0, 25))
      );
      components.push(roleSelectRow);
    }
  }

  // Back button
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:back_to_config:${hybridMenuId}`)
      .setLabel("Back to Menu Config")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️")
  );
  components.push(backRow);

  try {
    const responseData = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(responseData);
    } else {
      await interaction.reply(responseData);
    }
  } catch (error) {
    console.error("Error displaying hybrid roles configuration:", error);
    
    const errorData = { content: "❌ Something went wrong while displaying the roles configuration.", flags: MessageFlags.Ephemeral };
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorData);
      } else {
        await interaction.reply(errorData);
      }
    } catch (err) {
      console.error("Error sending error message:", err);
    }
  }
}

// Hybrid Menu Embed Customization (placeholder)
async function showHybridEmbedCustomization(interaction, hybridMenuId) {
  return sendEphemeralEmbed(interaction, "🚧 Embed customization coming soon! This will let you customize the appearance of your hybrid menu.", "#FFA500", "Coming Soon", false);
}

// Hybrid Menu Publishing (placeholder)
async function publishHybridMenu(interaction, hybridMenuId) {
  if (!hybridMenuId || typeof hybridMenuId !== 'string') {
    return interaction.editReply({ content: "❌ Invalid hybrid menu ID provided.", flags: MessageFlags.Ephemeral });
  }

  const menu = db.getHybridMenu(hybridMenuId);
  if (!menu) {
    return interaction.editReply({ content: "❌ Hybrid menu not found.", flags: MessageFlags.Ephemeral });
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

  const channel = interaction.channel;
  if (!channel.permissionsFor(botMember).has(['SendMessages', 'UseExternalEmojis', 'EmbedLinks'])) {
    return interaction.editReply({ content: "❌ Bot lacks required permissions in this channel: Send Messages, Use External Emojis, Embed Links.", flags: MessageFlags.Ephemeral });
  }

  // Validate configuration - check if at least info pages OR roles are configured
  const hasInfoPages = menu.pages && menu.pages.length > 0;
  const hasRoles = (menu.dropdownRoles && menu.dropdownRoles.length > 0) || (menu.buttonRoles && menu.buttonRoles.length > 0);
  
  if (!hasInfoPages && !hasRoles) {
    return interaction.editReply({ content: "❌ Cannot publish: Please configure at least one information page or reaction role.", flags: MessageFlags.Ephemeral });
  }

  // Validate roles still exist (if any are configured)
  if (hasRoles) {
    const allConfiguredRoles = [...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])];
    const validRoles = allConfiguredRoles.filter(roleId => interaction.guild.roles.cache.has(roleId));
    const invalidRoles = allConfiguredRoles.filter(roleId => !interaction.guild.roles.cache.has(roleId));

    if (invalidRoles.length > 0) {
      console.warn(`Hybrid menu ${hybridMenuId} contains ${invalidRoles.length} invalid roles:`, invalidRoles);
      // Clean up invalid roles
      if (menu.dropdownRoles) {
        menu.dropdownRoles = menu.dropdownRoles.filter(roleId => interaction.guild.roles.cache.has(roleId));
      }
      if (menu.buttonRoles) {
        menu.buttonRoles = menu.buttonRoles.filter(roleId => interaction.guild.roles.cache.has(roleId));
      }
      await db.updateHybridMenu(hybridMenuId, { 
        dropdownRoles: menu.dropdownRoles, 
        buttonRoles: menu.buttonRoles 
      });
    }
  }

  try {
    // Create the main embed and components using helper functions
    const embed = await createHybridMenuEmbed(interaction.guild, menu);
    const components = await buildHybridMenuComponents(interaction, menu, hybridMenuId);

    // Send the hybrid menu
    let sentMessage;
    if (menu.useWebhook) {
      try {
        const webhookName = menu.webhookName || "Hybrid Menu Webhook";
        const webhook = await getOrCreateWebhook(channel, webhookName);
        sentMessage = await webhook.send({
          embeds: [embed],
          components,
          username: menu.webhookName || client.user.displayName,
          avatarURL: menu.webhookAvatar || client.user.displayAvatarURL(),
        });
      } catch (webhookError) {
        console.error("Error publishing hybrid menu via webhook:", webhookError);
        // Fallback to regular bot message
        sentMessage = await channel.send({ embeds: [embed], components });
      }
    } else {
      sentMessage = await channel.send({ embeds: [embed], components });
    }

    // Update the hybrid menu with channel and message info
    await db.updateHybridMenu(hybridMenuId, {
      channelId: channel.id,
      messageId: sentMessage.id,
      guildId: interaction.guild.id
    });

    // Update performance metrics
    performanceMetrics.menus.published++;

    await sendEphemeralEmbed(interaction, `✅ Hybrid menu published successfully! Check ${channel} to see your combined info pages and roles.`, "#00FF00", "Success", false);

  } catch (error) {
    console.error("Error publishing hybrid menu:", error);
    await interaction.editReply({ content: "❌ Failed to publish hybrid menu. Please try again.", flags: MessageFlags.Ephemeral });
  }
}

// Hybrid Menu Preview
async function previewHybridMenu(interaction, hybridMenuId) {
  const menu = db.getHybridMenu(hybridMenuId);
  if (!menu) {
    return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
  }

  try {
    // Create the preview embed
    const embed = new EmbedBuilder()
      .setTitle(menu.name)
      .setDescription(menu.desc)
      .setColor(menu.embedColor || "#5865F2");

    if (menu.embedThumbnail) embed.setThumbnail(menu.embedThumbnail);
    if (menu.embedImage) embed.setImage(menu.embedImage);
    
    if (menu.embedAuthorName) {
      embed.setAuthor({
        name: menu.embedAuthorName,
        iconURL: menu.embedAuthorIconURL
      });
    }

    if (menu.embedFooterText) {
      embed.setFooter({
        text: menu.embedFooterText,
        iconURL: menu.embedFooterIconURL
      });
    }

    // Add preview fields
    const hasInfoPages = menu.pages && menu.pages.length > 0;
    const hasRoles = (menu.dropdownRoles && menu.dropdownRoles.length > 0) || (menu.buttonRoles && menu.buttonRoles.length > 0);

    if (hasInfoPages) {
      embed.addFields([
        { 
          name: "📋 Information Pages", 
          value: `${menu.pages.length} pages configured\nDisplay: ${menu.infoSelectionType?.join(', ') || 'Default'}`, 
          inline: true 
        }
      ]);
    }

    if (hasRoles) {
      embed.addFields([
        { 
          name: "🎭 Reaction Roles", 
          value: `${(menu.dropdownRoles?.length || 0) + (menu.buttonRoles?.length || 0)} roles configured\nDisplay: ${menu.roleSelectionType?.join(', ') || 'Default'}`, 
          inline: true 
        }
      ]);
    }

    embed.addFields([
      { 
        name: "🔍 Preview", 
        value: "This is how your hybrid menu will look when published. Components are disabled in preview mode.", 
        inline: false 
      }
    ]);

    const components = [];

    // Add disabled info pages dropdown if configured
    if (hasInfoPages && (menu.infoSelectionType?.includes("dropdown") || !menu.infoSelectionType)) {
      const infoOptions = menu.pages.slice(0, 25).map(page => ({
        label: page.name.substring(0, 100),
        value: `preview-info-${page.id}`,
        description: page.content?.substring(0, 100) || 'No description',
        emoji: page.emoji || '📋'
      }));

      if (infoOptions.length > 0) {
        const infoDropdown = new StringSelectMenuBuilder()
          .setCustomId(`preview-disabled`)
          .setPlaceholder("📚 Select a page to view... (Preview Mode)")
          .setDisabled(true)
          .addOptions(infoOptions);
        components.push(new ActionRowBuilder().addComponents(infoDropdown));
      }
    }

    // Add disabled roles dropdown if configured
    if (hasRoles && (menu.roleSelectionType?.includes("dropdown") || !menu.roleSelectionType)) {
      const roleOptions = (menu.dropdownRoles || []).map(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        
        return {
          label: role.name.substring(0, 100),
          value: `preview-role-${role.id}`,
          description: menu.dropdownRoleDescriptions?.[role.id]?.substring(0, 100),
          default: false
        };
      }).filter(Boolean);

      if (roleOptions.length > 0) {
        const roleDropdown = new StringSelectMenuBuilder()
          .setCustomId(`preview-disabled-2`)
          .setPlaceholder("🎭 Select roles to toggle... (Preview Mode)")
          .setDisabled(true)
          .addOptions(roleOptions);
        components.push(new ActionRowBuilder().addComponents(roleDropdown));
      }
    }

    // Add disabled buttons if configured
    if (hasInfoPages && menu.infoSelectionType?.includes("button")) {
      const buttonRows = [];
      let currentRow = new ActionRowBuilder();
      let buttonsInRow = 0;

      menu.pages.forEach(page => {
        if (buttonsInRow >= 5) {
          buttonRows.push(currentRow);
          currentRow = new ActionRowBuilder();
          buttonsInRow = 0;
        }

        const button = new ButtonBuilder()
          .setCustomId(`preview-info-${page.id}`)
          .setLabel(page.name.substring(0, 80))
          .setStyle(ButtonStyle[page.buttonColor] || ButtonStyle.Primary)
          .setDisabled(true);

        if (page.emoji) button.setEmoji(page.emoji);

        currentRow.addComponents(button);
        buttonsInRow++;
      });

      if (buttonsInRow > 0) {
        buttonRows.push(currentRow);
      }

      components.push(...buttonRows);
    }

    if (hasRoles && menu.roleSelectionType?.includes("button")) {
      const buttonRows = [];
      let currentRow = new ActionRowBuilder();
      let buttonsInRow = 0;

      (menu.buttonRoles || []).forEach(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return;

        if (buttonsInRow >= 5) {
          buttonRows.push(currentRow);
          currentRow = new ActionRowBuilder();
          buttonsInRow = 0;
        }

        const buttonColorName = menu.buttonColors?.[role.id] || 'Secondary';
        const buttonStyle = ButtonStyle[buttonColorName] || ButtonStyle.Secondary;

        const button = new ButtonBuilder()
          .setCustomId(`preview-role-${role.id}`)
          .setLabel(role.name.substring(0, 80))
          .setStyle(buttonStyle)
          .setDisabled(true);

        const parsedEmoji = parseEmoji(menu.buttonEmojis?.[role.id]);
        if (parsedEmoji) {
          button.setEmoji(parsedEmoji);
        }

        currentRow.addComponents(button);
        buttonsInRow++;
      });

      if (buttonsInRow > 0) {
        buttonRows.push(currentRow);
      }

      components.push(...buttonRows);
    }

    await interaction.editReply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });

  } catch (error) {
    console.error("Error previewing hybrid menu:", error);
    await sendEphemeralEmbed(interaction, "❌ Failed to generate preview. Please try again.", "#FF0000", "Error", false);
  }
}

// Show Component Order Configuration
async function showComponentOrderConfiguration(interaction, hybridMenuId) {
  const menu = db.getHybridMenu(hybridMenuId);
  if (!menu) {
    return sendEphemeralEmbed(interaction, "❌ Hybrid menu not found.", "#FF0000", "Error", false);
  }

  const embed = new EmbedBuilder()
    .setTitle(`📑 Component Order: ${menu.name}`)
    .setDescription("Configure the order in which components appear in your published hybrid menu.\n\n**Current Order:**")
    .setColor("#5865F2");

  // Get current component order or use defaults
  const currentOrder = menu.componentOrder || {
    infoDropdown: 1,
    roleDropdown: 2,
    infoButtons: 3,
    roleButtons: 4
  };

  // Create ordered list of components
  const orderEntries = Object.entries(currentOrder).sort((a, b) => a[1] - b[1]);
  const orderDisplay = orderEntries.map(([key, order], index) => {
    const componentNames = {
      infoDropdown: "📋 Info Pages Dropdown",
      roleDropdown: "🎭 Role Selection Dropdown", 
      infoButtons: "📋 Info Pages Buttons",
      roleButtons: "🎭 Role Selection Buttons"
    };
    return `${index + 1}. ${componentNames[key] || key}`;
  }).join('\n');

  embed.addFields([
    { name: "Current Component Order", value: orderDisplay, inline: false },
    { name: "How it works", value: "Components are arranged in the published menu according to this order. Lower numbers appear first.", inline: false }
  ]);

  const components = [];

  // Add reorder buttons
  const reorderRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:move_component:${hybridMenuId}:infoDropdown:up`)
      .setLabel("📋↑ Info Dropdown Up")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentOrder.infoDropdown === 1),
    new ButtonBuilder()
      .setCustomId(`hybrid:move_component:${hybridMenuId}:infoDropdown:down`)
      .setLabel("📋↓ Info Dropdown Down")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentOrder.infoDropdown === 4),
    new ButtonBuilder()
      .setCustomId(`hybrid:move_component:${hybridMenuId}:roleDropdown:up`)
      .setLabel("🎭↑ Role Dropdown Up")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentOrder.roleDropdown === 1)
  );

  const reorderRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hybrid:move_component:${hybridMenuId}:roleDropdown:down`)
      .setLabel("🎭↓ Role Dropdown Down")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentOrder.roleDropdown === 4),
    new ButtonBuilder()
      .setCustomId(`hybrid:reset_component_order:${hybridMenuId}`)
      .setLabel("🔄 Reset to Default")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`hybrid:back_to_config:${hybridMenuId}`)
      .setLabel("Back to Menu Config")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️")
  );

  components.push(reorderRow1, reorderRow2);

  try {
    const responseData = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(responseData);
    } else {
      await interaction.reply(responseData);
    }

    console.log(`[Hybrid Debug] Successfully showed component order configuration`);
  } catch (error) {
    console.error(`[Hybrid Debug] Error showing component order:`, error);
    return sendEphemeralEmbed(interaction, "❌ Error showing component order configuration. Please try again.", "#FF0000", "Error", false);
  }
}

// Periodic member count update system
let lastMemberCountUpdate = 0;
const MEMBER_COUNT_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function updateAllMemberCounts(forceUpdate = false) {
    const now = Date.now();
    if (!forceUpdate && now - lastMemberCountUpdate < MEMBER_COUNT_UPDATE_INTERVAL) {
        return;
    }
    lastMemberCountUpdate = now;

    try {
        // Update reaction role menus
        for (const [menuId, menu] of db.menuData.entries()) {
            if (menu.showMemberCounts && menu.channelId && menu.messageId) {
                try {
                    const guild = client.guilds.cache.get(menu.guildId);
                    if (!guild) continue;
                    
                    const channel = await guild.channels.fetch(menu.channelId).catch(() => null);
                    if (!channel) continue;
                    
                    const message = await channel.messages.fetch(menu.messageId).catch(() => null);
                    if (!message) continue;
                    
                    // Create a mock interaction object for the update function
                    const mockInteraction = {
                        guild: guild,
                        user: client.user,
                        member: guild.members.me
                    };
                    
                    await updatePublishedMessageComponents(mockInteraction, menu, menuId, true);
                    console.log(`[Member Count Update] Updated reaction role menu ${menuId}`);
                } catch (error) {
                    console.error(`[Member Count Update] Error updating reaction role menu ${menuId}:`, error);
                }
            }
        }

        // Update hybrid menus
        for (const [hybridMenuId, hybridMenu] of db.hybridMenuData.entries()) {
            if (hybridMenu.showMemberCounts && hybridMenu.channelId && hybridMenu.messageId) {
                try {
                    const guild = client.guilds.cache.get(hybridMenu.guildId);
                    if (!guild) continue;
                    
                    const channel = await guild.channels.fetch(hybridMenu.channelId).catch(() => null);
                    if (!channel) continue;
                    
                    const message = await channel.messages.fetch(hybridMenu.messageId).catch(() => null);
                    if (!message) continue;
                    
                    // Create a mock interaction object for the update function
                    const mockInteraction = {
                        guild: guild,
                        user: client.user,
                        member: guild.members.me
                    };
                    
                    await updatePublishedHybridMenuComponents(mockInteraction, hybridMenu, hybridMenuId, true);
                    console.log(`[Member Count Update] Updated hybrid menu ${hybridMenuId}`);
                } catch (error) {
                    console.error(`[Member Count Update] Error updating hybrid menu ${hybridMenuId}:`, error);
                }
            }
        }
    } catch (error) {
        console.error('[Member Count Update] Error in periodic update:', error);
    }
}

// Start periodic member count updates when bot is ready
client.once('ready', () => {
    console.log('Bot is ready! Starting periodic member count updates...');
    setInterval(updateAllMemberCounts, 60000); // Check every minute, but only update every 5 minutes
});

// Listen for role updates to refresh member counts in real time
let memberCountUpdateQueued = false;

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        // Check if roles changed
        const oldRoles = new Set(oldMember.roles.cache.keys());
        const newRoles = new Set(newMember.roles.cache.keys());
        
        const rolesChanged = oldRoles.size !== newRoles.size || 
                           [...oldRoles].some(role => !newRoles.has(role)) || 
                           [...newRoles].some(role => !oldRoles.has(role));
        
        if (rolesChanged && !memberCountUpdateQueued) {
            memberCountUpdateQueued = true;
            console.log(`[Role Update] Member ${newMember.user.tag} role changes detected, queueing member count update...`);
            // Delay update to batch multiple rapid changes
            setTimeout(async () => {
                try {
                    await updateAllMemberCounts(true);
                } finally {
                    memberCountUpdateQueued = false;
                }
            }, 2000);
        }
    } catch (error) {
        console.error('[Role Update] Error handling member update:', error);
        memberCountUpdateQueued = false;
    }
});

client.on('guildMemberAdd', async (member) => {
    try {
        if (!memberCountUpdateQueued) {
            memberCountUpdateQueued = true;
            console.log(`[Member Join] ${member.user.tag} joined ${member.guild.name}, queueing member count update...`);
            setTimeout(async () => {
                try {
                    await updateAllMemberCounts(true);
                } finally {
                    memberCountUpdateQueued = false;
                }
            }, 2000);
        }
    } catch (error) {
        console.error('[Member Join] Error handling member add:', error);
        memberCountUpdateQueued = false;
    }
});

client.on('guildMemberRemove', async (member) => {
    try {
        if (!memberCountUpdateQueued) {
            memberCountUpdateQueued = true;
            console.log(`[Member Leave] ${member.user.tag} left ${member.guild.name}, queueing member count update...`);
            setTimeout(async () => {
                try {
                    await updateAllMemberCounts(true);
                } finally {
                    memberCountUpdateQueued = false;
                }
            }, 2000);
        }
    } catch (error) {
        console.error('[Member Leave] Error handling member remove:', error);
        memberCountUpdateQueued = false;
    }
});

// Bot login
client.login(process.env.TOKEN).catch(error => {
    console.error("Failed to login:", error);
    process.exit(1);
});
