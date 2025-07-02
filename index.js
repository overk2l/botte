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
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    if (firebaseConfig.projectId && firebaseConfig.projectId !== 'missing-project-id') {
      firebaseApp = initializeApp(firebaseConfig);
      dbFirestore = getFirestore(firebaseApp);
      firebaseEnabled = true;
      console.log("[Firebase] Successfully initialized with project:", firebaseConfig.projectId);
    } else {
      console.warn("[Firebase] Invalid projectId in FIREBASE_CONFIG. Running without persistence.");
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
   * Updates an existing menu's data in both memory and Firestore.
   * @param {string} menuId - The ID of the menu to update.
   * @param {Object} data - The partial data object to merge into the existing menu.
   */
  async updateMenu(menuId, data) {
    const menu = this.menuData.get(menuId);
    if (!menu) {
      console.warn(`[Database] Attempted to update non-existent menu: ${menuId}`);
      return;
    }
    Object.assign(menu, data); // Update in-memory map

    if (firebaseEnabled) {
      try {
        const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, menuId);
        await setDoc(menuDocRef, menu); // Overwrite with updated data in Firestore
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

    if (firebaseEnabled) {
      try {
        // Delete from Firestore
        const menuDocRef = doc(dbFirestore, `artifacts/${appId}/public/data/reaction_role_menus`, menuId);
        await deleteDoc(menuDocRef);
        console.log(`[Database] Deleted menu with ID: ${menuId} from Firestore`);
      } catch (error) {
        console.error(`[Database] Error deleting menu ${menuId} from Firestore:`, error);
        // Continue with in-memory deletion only
      }
    } else {
      console.log(`[Database] Deleted menu with ID: ${id} (memory only)`);
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
  
  // For unicode emojis, simply return the emoji as the name.
  // Discord.js handles most common unicode emojis when passed this way.
  // Removed the \p{Emoji}/u check for broader Node.js compatibility.
  return { name: emoji };
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

/**
 * Sends an ephemeral embed reply or follow-up to an interaction.
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} description - The description for the embed.
 * @param {string} [color="#5865F2"] - The color of the embed (hex code).
 * @param {string} [title="Notification"] - The title of the embed.
 */
async function sendEphemeralEmbed(interaction, description, color = "#5865F2", title = "Notification") {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);
    
    try {
        // Check if interaction has already been replied/deferred
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral, components: [] });
        } else {
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    } catch (error) {
        console.error("Error sending ephemeral embed:", error);
        // Try followUp as last resort
        try {
            await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (followUpError) {
            console.error("Error sending follow-up:", followUpError);
        }
    }
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
        if (!originalChannel) {
            console.error(`Channel ${menu.channelId} not found for menu ${menu.id}`);
            return;
        }

        const originalMessage = await originalChannel.messages.fetch(menu.messageId);

        const components = [];

        // Rebuild Dropdown Select Menu
        if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length > 0) {
            const dropdownOptions = (menu.dropdownRoleOrder.length > 0
                ? menu.dropdownRoleOrder
                : menu.dropdownRoles
            ).map(roleId => {
                const role = guild.roles.cache.get(roleId);
                if (!role) return null;
                return {
                    label: role.name,
                    value: role.id,
                    emoji: parseEmoji(menu.dropdownEmojis[role.id]),
                    description: menu.dropdownRoleDescriptions[role.id] || undefined,
                    default: false // Always set default to false so roles are not pre-selected
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

        // Rebuild Buttons
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
                    .setStyle(member.roles.cache.has(roleId) ? ButtonStyle.Success : ButtonStyle.Secondary);
                
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
                }
            }
            if (currentRow.components.length > 0) {
                buttonRows.push(currentRow);
            }
            components.push(...buttonRows);
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
        if (error.code === 10003 || error.code === 50001 || error.code === 10008) { // Unknown Channel, Missing Access, or Unknown Message
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
    (interaction.isButton() && interaction.customId.startsWith("rr:prompt_raw_embed_json")) || // This button directly shows a modal
    (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:select_role_for_description:"))
    // Removed: (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr:select:menu_for_raw_json"))
    // Removed: (interaction.isModalSubmit() && interaction.customId.startsWith("rr:modal:raw_embed_json:")) // This was incorrect here
  );

  // Check if it's a modal submission - these need deferUpdate
  const isModalSubmission = interaction.isModalSubmit();

  // Defer non-modal-trigger interactions
  if (!interaction.replied && !interaction.deferred && !isModalTrigger && !isModalSubmission) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(e => console.error("Error deferring reply:", e));
  }

  try {
    // Show Firebase warning only once per interaction for admin commands
    if (!firebaseEnabled && interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const relevantInteraction = (
        (interaction.isChatInputCommand() && interaction.commandName === "dashboard") ||
        (interaction.customId?.startsWith("rr:") && !interaction.customId.startsWith("rr-role-"))
      );
      
      if (relevantInteraction && !interaction.replied) {
        await interaction.followUp({
          content: "⚠️ **Warning: Firebase is not configured.** Your bot's data (menus, roles, etc.) will not persist between restarts. To enable persistence, set the `FIREBASE_CONFIG` environment variable with a valid Firebase configuration.",
          flags: MessageFlags.Ephemeral
        }).catch(e => console.error("Error sending Firebase warning:", e));
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
        if (action === "back") return sendMainDashboard(interaction);
      }

      if (ctx === "rr") {
        // All dashboard-related buttons should also have a permission check
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.editReply({ content: "❌ You need Administrator permissions to configure reaction roles.", flags: MessageFlags.Ephemeral });
        }

        // Assign menuId, type based on action within the rr context
        if (action === "create") {
          // No menuId needed yet, it's created in the modal submit
        } else if (["publish", "edit_published", "delete_published", "confirm_delete_published", "cancel_delete_published", "setlimits", "setexclusions", "customize_embed", "customize_footer", "toggle_webhook", "config_webhook", "delete_menu", "confirm_delete_menu", "cancel_delete_menu", "custom_messages", "prompt_role_description_select"].includes(action)) {
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
                new TextInputBuilder().setCustomId("name").setLabel("Menu Name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("desc").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)
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
            await interaction.editReply({ content: "Menu deletion cancelled.", components: [], flags: MessageFlags.Ephemeral });
            return showMenuConfiguration(interaction, menuId); // Go back to the menu configuration
        }

        if (action === "toggle_type") { // New action for toggling type and prompting role management
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
            await sendEphemeralEmbed(interaction, `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} roles disabled and cleared.`, "#00FF00", "Success");
            return showMenuConfiguration(interaction, menuId);
          } else {
            // If type is currently disabled, enable it and prompt to manage roles
            currentSelectionTypes.add(type);
            await db.saveSelectionType(menuId, Array.from(currentSelectionTypes));
            await sendEphemeralEmbed(interaction, `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} roles enabled. Now select roles.`, "#00FF00", "Success");
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

        if (action === "reorder_dropdown" || action === "reorder_button") {
          type = action.split("_")[1]; // 'dropdown' or 'button'
          menuId = parts[2];
          
          const menu = db.getMenu(menuId);
          if (!menu) {
            return interaction.reply({ 
              content: "Menu not found.", 
              ephemeral: true 
            });
          }

          // Use the actual roles array, not the order array for counting
          const actualRoles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
          const currentOrder = type === "dropdown" 
            ? (menu.dropdownRoleOrder || menu.dropdownRoles || []) 
            : (menu.buttonRoleOrder || menu.buttonRoles || []);
          
          // Check if there are roles to reorder - use actualRoles for the count
          if (actualRoles.length <= 1) {
            return interaction.reply({ 
              content: `Not enough ${type} roles to reorder. Found ${actualRoles.length} role(s).`, 
              ephemeral: true 
            });
          }

          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:reorder_roles:${menuId}:${type}`)
            .setTitle(`Reorder ${type.charAt(0).toUpperCase() + type.slice(1)} Roles`);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("role_ids_order")
                .setLabel("Role IDs (comma-separated)")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder("roleId1, roleId2, roleId3")
                .setValue(currentOrder.join(", "))
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
                  )) || "{}")
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
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
          if (!allRoles.size) return interaction.editReply({ content: "No roles available to set exclusions.", flags: MessageFlags.Ephemeral });

          // Limit to 25 options (Discord limitation)
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
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", flags: MessageFlags.Ephemeral });
          const menu = db.getMenu(menuId);
          if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

          const newStateBoolean = !menu.useWebhook; // Get the actual boolean state
          await db.saveWebhookSettings(menuId, { useWebhook: newStateBoolean });

          await interaction.editReply({
            content: `✅ Webhook sending is now ${newStateBoolean ? "ENABLED" : "DISABLED"}`,
            flags: MessageFlags.Ephemeral
          });
          return showMenuConfiguration(interaction, menuId); // Refresh the menu config view
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

        if (action === "manage_roles") { // Handler for "Manage Roles" buttons
          if (!menuId || !type) return interaction.editReply({ content: "Menu ID or type missing.", flags: MessageFlags.Ephemeral });
          return promptManageRoles(interaction, menuId, type); // Call the new helper function
        }

        if (action === "prompt_raw_embed_json") { // New action for raw JSON embed input
          // Directly show the modal for JSON input for creating a new menu
          const modal = new ModalBuilder()
            .setCustomId(`rr:modal:create_from_raw_json`) // New custom ID for this modal
            .setTitle("Create Menu from Raw Embed JSON");

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("raw_json_input")
                .setLabel("Paste Embed JSON Here")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                // Updated placeholder to be shorter
                .setPlaceholder("e.g., {\"title\": \"My Embed\", \"description\": \"Hello!\"}")
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
      const selectType = parts[2]; // Added to differentiate select menus

      if (ctx === "rr") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure reaction roles.", "#FF0000", "Permission Denied");
        }

        if (action === "selectmenu") {
          const targetMenuId = interaction.values[0];
          return showMenuConfiguration(interaction, targetMenuId);
        }

        if (action === "save_managed_roles") { // Renamed from selectroles
          const selectedRoleIds = interaction.values;
          const type = parts[2]; // 'dropdown' or 'button'
          const menuId = parts[3];
          
          const menu = db.getMenu(menuId);
          if (!menu) {
            return sendEphemeralEmbed(interaction, "Menu not found. Please re-select the menu.", "#FF0000", "Error");
          }

          // This action now always overwrites the roles for the given type
          await db.saveRoles(menuId, selectedRoleIds, type);

          await sendEphemeralEmbed(interaction, `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} roles updated.`, "#00FF00", "Success");
          return showMenuConfiguration(interaction, menuId); // Refresh after roles are saved
        }

        if (action === "select_trigger_role") {
          const triggerRoleId = interaction.values[0];
          const menuId = parts[2]; // menuId is at parts[2] for select_trigger_role
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found. Please re-select the menu.", "#FF0000", "Error");
          }
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id && r.id !== triggerRoleId);

          if (!allRoles.size) {
            return sendEphemeralEmbed(interaction, "No other roles available to set as exclusions.", "#FF0000", "No Roles Found");
          }

          // Limit to 25 options (Discord limitation)
          const roleOptions = Array.from(allRoles.values()).slice(0, 25).map((r) => ({
            label: r.name,
            value: r.id,
            default: (menu.exclusionMap[triggerRoleId] || []).includes(r.id)
          }));

          const selectExclusionRoles = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_exclusion_roles:${triggerRoleId}:${menuId}`)
            .setPlaceholder(`Select roles to exclude when ${interaction.guild.roles.cache.get(triggerRoleId).name} is picked...`)
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
          const triggerRoleId = parts[2]; // The role that triggers the exclusion
          const menuId = parts[3]; // The menuId
          const exclusionRoleIds = interaction.values; // The roles to be excluded

          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found. Please re-select the menu.", "#FF0000", "Error");
          }
          const newExclusionMap = { ...menu.exclusionMap, [triggerRoleId]: exclusionRoleIds };
          await db.saveExclusionMap(menuId, newExclusionMap);

          await sendEphemeralEmbed(interaction, "✅ Exclusion roles saved!", "#00FF00", "Success");
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "select_role_for_description") {
          const roleId = interaction.values[0];
          const menuId = parts[2]; // menuId is at parts[2] for select_role_for_description
          const menu = db.getMenu(menuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
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
      let type; // Used for reorder_roles modal
      if (modalType === "create") {
          currentMenuId = null; // No menuId yet for creation modal
      } else if (modalType === "addemoji" || modalType === "role_description") {
          type = parts[3];
          currentMenuId = parts[4];
      } else if (modalType === "reorder_roles") {
          currentMenuId = parts[3];
          type = parts[4]; // 'dropdown' or 'button'
      } else if (modalType === "create_from_raw_json") { // New modal for creating from raw JSON
          currentMenuId = null; // Menu ID will be generated here
      }
      else {
          currentMenuId = parts[3]; // Default for other modals like setlimits, customize_embed, webhook_branding, etc.
      }

      if (ctx === "rr" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return sendEphemeralEmbed(interaction, "❌ You need Administrator permissions to configure reaction roles.", "#FF0000", "Permission Denied");
        }

        if (modalType === "create") {
          const name = interaction.fields.getTextInputValue("name");
          const desc = interaction.fields.getTextInputValue("desc");
          const newMenuId = await db.createMenu(interaction.guild.id, name, desc);
          return showMenuConfiguration(interaction, newMenuId);
        }

        if (modalType === "addemoji") {
          if (!currentMenuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error");
          const emojis = {};
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
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
              // Clear the emoji if empty input
              emojis[roleId] = null;
            }
          }
          await db.saveEmojis(currentMenuId, emojis, type);
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "reorder_roles") {
          try {
            if (!currentMenuId || !type) {
              return sendEphemeralEmbed(interaction, "Menu ID or type missing.", "#FF0000", "Error");
            }
            
            const menu = db.getMenu(currentMenuId);
            if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
            }

            const roleIdsOrderInput = interaction.fields.getTextInputValue("role_ids_order");
            
            // Validate input
            if (!roleIdsOrderInput || !roleIdsOrderInput.trim()) {
              return sendEphemeralEmbed(interaction, "No role IDs provided.", "#FF0000", "Error");
            }
            
            const newOrderRaw = roleIdsOrderInput.split(",").map(id => id.trim()).filter(id => id);
            
            if (newOrderRaw.length === 0) {
              return sendEphemeralEmbed(interaction, "No valid role IDs found.", "#FF0000", "Error");
            }

            const existingRoles = type === "dropdown" ? (menu.dropdownRoles || []) : (menu.buttonRoles || []);
            
            if (existingRoles.length === 0) {
              return sendEphemeralEmbed(interaction, `No ${type} roles found in this menu.`, "#FF0000", "Error");
            }
            
            const newOrderValidated = [];
            const seenRoleIds = new Set();

            for (const roleId of newOrderRaw) {
              if (existingRoles.includes(roleId) && !seenRoleIds.has(roleId)) {
                newOrderValidated.push(roleId);
                seenRoleIds.add(roleId);
              } else if (!existingRoles.includes(roleId)) {
                console.warn(`Role ID ${roleId} from reorder input not found in existing ${type} roles for menu ${currentMenuId}. Skipping.`);
              } else if (seenRoleIds.has(roleId)) {
                console.warn(`Duplicate role ID ${roleId} found in reorder input for menu ${currentMenuId}. Skipping duplicate.`);
              }
            }

            // Ensure all original roles are still present, even if not explicitly reordered (append to end)
            for (const existingRoleId of existingRoles) {
              if (!seenRoleIds.has(existingRoleId)) {
                newOrderValidated.push(existingRoleId);
              }
            }

            // Validate that we have the same number of roles
            if (newOrderValidated.length !== existingRoles.length) {
              console.warn(`Mismatch in role count for menu ${currentMenuId}. Expected: ${existingRoles.length}, Got: ${newOrderValidated.length}`);
            }

            await db.saveRoleOrder(currentMenuId, newOrderValidated, type);
            
            return showMenuConfiguration(interaction, currentMenuId);
            
          } catch (error) {
            console.error("Error in reorder modal submission:", error);
            return sendEphemeralEmbed(interaction, "An error occurred while reordering roles.", "#FF0000", "Error");
          }
        }

        if (modalType === "setlimits") {
          if (!currentMenuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error");
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
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
            return sendEphemeralEmbed(interaction, "❌ Invalid JSON for Regional Role Assignments. Please check the format.", "#FF0000", "Input Error");
          }

          await db.saveRegionalLimits(currentMenuId, newRegionalLimits);

          let maxRolesLimit = null;
          if (maxRolesLimitInput) {
            const parsedLimit = parseInt(maxRolesLimitInput);
            if (!isNaN(parsedLimit) && parsedLimit >= 0) {
              maxRolesLimit = parsedLimit;
            } else {
              return sendEphemeralEmbed(interaction, "❌ Invalid value for Max Roles Per Menu. Please enter a number.", "#FF0000", "Input Error");
            }
          }
          await db.saveMaxRolesLimit(currentMenuId, maxRolesLimit);
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "customize_embed") {
          if (!currentMenuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error");
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
          }

          const embedColor = interaction.fields.getTextInputValue("embed_color") || null;
          const embedThumbnail = interaction.fields.getTextInputValue("thumbnail_url") || null;
          const embedImage = interaction.fields.getTextInputValue("image_url") || null;
          const embedAuthorName = interaction.fields.getTextInputValue("author_name") || null;
          const embedAuthorIconURL = interaction.fields.getTextInputValue("author_icon_url") || null;

          // Validate color format
          if (embedColor && !/^#[0-9A-F]{6}$/i.test(embedColor)) {
            return sendEphemeralEmbed(interaction, "❌ Invalid color format. Please use hex format like #FF0000", "#FF0000", "Input Error");
          }

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
          if (!currentMenuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error");
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
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
          if (!currentMenuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error");
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
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
          if (!currentMenuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error");
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
          }
          const description = interaction.fields.getTextInputValue("description_input");
          await db.saveRoleDescriptions(currentMenuId, { [roleId]: description || null });
          return showMenuConfiguration(interaction, currentMenuId);
        }

        if (modalType === "webhook_branding") {
          if (!currentMenuId) return sendEphemeralEmbed(interaction, "Menu ID missing.", "#FF0000", "Error");
          const menu = db.getMenu(currentMenuId);
          if (!menu) {
              return sendEphemeralEmbed(interaction, "Menu not found.", "#FF0000", "Error");
          }

          const name = interaction.fields.getTextInputValue("name");
          const avatar = interaction.fields.getTextInputValue("avatar");

          await db.saveWebhookSettings(currentMenuId, {
            webhookName: name || null,
            webhookAvatar: avatar || null
          });
          return showMenuConfiguration(interaction, currentMenuId);
        }

        // New handler for creating a menu from raw JSON
        if (modalType === "create_from_raw_json") {
            const jsonString = interaction.fields.getTextInputValue("raw_json_input");

            let parsedJson;
            try {
                parsedJson = JSON.parse(jsonString);
            } catch (e) {
                return sendEphemeralEmbed(interaction, "❌ Invalid JSON format. Please ensure it's valid JSON.", "#FF0000", "Input Error");
            }

            // Extract embed data from the first embed in the 'embeds' array if it exists
            const embedData = (parsedJson.embeds && Array.isArray(parsedJson.embeds) && parsedJson.embeds.length > 0)
                               ? parsedJson.embeds[0]
                               : parsedJson; // Fallback to top-level if no embeds array or empty

            const menuName = embedData.title || "New Menu from JSON";
            const menuDescription = embedData.description || "No description provided.";

            // Create the new menu
            const newMenuId = await db.createMenu(interaction.guild.id, menuName, menuDescription);
            // No need to fetch newMenu again, as createMenu already adds it to menuData

            const embedUpdateData = {};

            // Map JSON fields to menu properties for embed customization
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
      }
    }

    // Role adding/removing on select menu or button press (User-facing)
    if ((interaction.isStringSelectMenu() && interaction.customId.startsWith("rr-role-select:")) ||
        (interaction.isButton() && interaction.customId.startsWith("rr-role-button:"))) {

        // Ensure interaction is deferred if it wasn't already
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(e => console.error("Error deferring reply for role interaction:", e));
        }

        const parts = interaction.customId.split(":");
        const menuId = parts[1];
        
        if (!menuId) {
            console.error(`No menuId found in customId: ${interaction.customId}`);
            return sendEphemeralEmbed(interaction, "❌ Invalid interaction. Please try again.", "#FF0000", "Error");
        }
        
        const menu = db.getMenu(menuId);
        if (!menu) {
            console.error(`Attempted to access non-existent menu with ID: ${menuId} during user interaction.`);
            return sendEphemeralEmbed(interaction, "❌ This reaction role menu is no longer valid. It might have been deleted or corrupted.", "#FF0000", "Error");
        }

        const selectedInteractionRoleIds = interaction.isStringSelectMenu() ? interaction.values : [interaction.customId.split(":")[2]];

        let rolesToAdd = [];
        let rolesToRemove = [];
        let messages = [];

        const currentMemberRoleIds = interaction.member.roles.cache.map(r => r.id);
        const allMenuRoleIds = [...(menu.dropdownRoles || []), ...(menu.buttonRoles || [])];
        const currentMenuRolesHeldByMember = currentMemberRoleIds.filter(id => allMenuRoleIds.includes(id));

        // Determine roles to add and remove based on selection and current member roles
        if (interaction.isStringSelectMenu()) {
            // For dropdowns, the selection represents the FINAL STATE the user wants
            const dropdownRolesFromMenu = menu.dropdownRoles || [];
            const currentDropdownRolesHeld = currentMemberRoleIds.filter(id => dropdownRolesFromMenu.includes(id));
            
            // Roles to add: roles that are selected but not currently held
            rolesToAdd = selectedInteractionRoleIds.filter(id => !currentMemberRoleIds.includes(id));
            
            // Roles to remove: dropdown roles that are currently held but NOT selected
            rolesToRemove = currentDropdownRolesHeld.filter(id => !selectedInteractionRoleIds.includes(id));
            
        } else { // Button interaction (already behaves as a toggle)
            const clickedRoleId = selectedInteractionRoleIds[0];
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
        let potentialNewRoleIds = [...currentMemberRoleIds];

        if (interaction.isStringSelectMenu()) {
            // For dropdowns: Remove all current dropdown roles, then add the selected ones
            const dropdownRolesFromMenu = menu.dropdownRoles || [];
            potentialNewRoleIds = potentialNewRoleIds.filter(id => !dropdownRolesFromMenu.includes(id));
            potentialNewRoleIds.push(...selectedInteractionRoleIds);
        } else { // Button interaction
            const clickedRoleId = selectedInteractionRoleIds[0];
            if (potentialNewRoleIds.includes(clickedRoleId)) {
                potentialNewRoleIds = potentialNewRoleIds.filter(id => id !== clickedRoleId);
            } else {
                potentialNewRoleIds.push(clickedRoleId);
            }
        }
        
        // Handle exclusions for potential new roles
        for (const roleId of rolesToAdd) {
            if (menu.exclusionMap && menu.exclusionMap[roleId]) {
                potentialNewRoleIds = potentialNewRoleIds.filter(id => !menu.exclusionMap[roleId].includes(id));
            }
        }
        
        potentialNewRoleIds = [...new Set(potentialNewRoleIds)]; // Final deduplication for limit check

        // Filter potentialNewRoleIds to only include roles from THIS menu for limit checks
        const potentialMenuRoleIds = potentialNewRoleIds.filter(id => allMenuRoleIds.includes(id));

        // Check regional limits
        const regionalViolations = checkRegionalLimits(interaction.member, menu, potentialMenuRoleIds);
        if (regionalViolations.length > 0) {
            await sendEphemeralEmbed(interaction, menu.limitExceededMessage || `❌ ${regionalViolations.join("\n")}`, "#FF0000", "Limit Exceeded");
            await updatePublishedMessageComponents(interaction, menu); // Re-sync components on published message
            return;
        }

        // Check overall max roles limit
        if (menu.maxRolesLimit !== null && menu.maxRolesLimit > 0) {
            if (potentialMenuRoleIds.length > menu.maxRolesLimit) {
                await sendEphemeralEmbed(interaction, menu.limitExceededMessage || `❌ You can only have a maximum of ${menu.maxRolesLimit} roles from this menu.`, "#FF0000", "Limit Exceeded");
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
                await sendEphemeralEmbed(interaction, messages.join("\n"), "#00FF00", "Role Update");
            } else {
                await sendEphemeralEmbed(interaction, "No changes made to your roles.", "#FFFF00", "No Change");
            }

            // Update the original published message components to reflect current selections
            await updatePublishedMessageComponents(interaction, menu);

        } catch (error) {
            console.error("Error updating roles:", error);
            if (error.code === 50013) { // Missing Permissions
                await sendEphemeralEmbed(interaction, "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.", "#FF0000", "Permission Error");
            } else {
                await sendEphemeralEmbed(interaction, "❌ There was an error updating your roles. Please try again later.", "#FF0000", "Error");
            }
        }
    }

    } catch (error) {
        console.error("Unhandled error during interaction:", error);
        // Fallback error reply if no other reply has been sent
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({ content: "❌ An unexpected error occurred. Please try again.", ephemeral: true });
            } catch (replyError) {
                console.error("Error sending error reply:", replyError);
            }
        } else {
            await sendEphemeralEmbed(interaction, "❌ An unexpected error occurred. Please try again.", "#FF0000", "Error");
        }
    }
});

/**
 * Helper function to prompt the user to select roles for a given type (dropdown or button).
 * @param {import('discord.js').Interaction} interaction - The interaction to reply to.
 * @param {string} menuId - The ID of the menu being configured.
 * @param {'dropdown'|'button'} type - The type of roles to manage.
 */
async function promptManageRoles(interaction, menuId, type) {
  const menu = db.getMenu(menuId);
  if (!menu) {
    return sendEphemeralEmbed(interaction, "Menu not found. Please re-select the menu.", "#FF0000", "Error");
  }

  const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
  if (allRoles.size === 0) {
    return sendEphemeralEmbed(interaction, "❌ No roles available in this guild to manage. Please create some roles first.", "#FF0000", "No Roles Found");
  }

  const currentRolesForType = (menu[type + "Roles"] || []);

  // Limit to 25 options (Discord limitation)
  const roleOptions = Array.from(allRoles.values()).slice(0, 25).map((r) => ({
      label: r.name,
      value: r.id,
      default: currentRolesForType.includes(r.id) // Pre-select current roles
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`rr:save_managed_roles:${type}:${menuId}`)
    .setPlaceholder(`Select/Deselect your ${type} roles...`)
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

    const rawJsonButton = new ButtonBuilder() // New button for raw JSON embed
        .setCustomId(`rr:prompt_raw_embed_json`) // This button now directly triggers a modal for creation
        .setLabel("Create from Raw Embed JSON")
        .setStyle(ButtonStyle.Secondary);

    const backButton = new ButtonBuilder()
        .setCustomId("dash:back")
        .setLabel("Back to Dashboard")
        .setStyle(ButtonStyle.Secondary);

    components.push(new ActionRowBuilder().addComponents(createButton, rawJsonButton, backButton)); // Added rawJsonButton

    try {
        await interaction.editReply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    } catch (error) {
        console.error("Error displaying reaction roles dashboard:", error);
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

  // Fixed the invalid property reference
  const menuIdValue = menuId; // Use menuId directly instead of menu.id

  const embed = new EmbedBuilder()
    .setTitle(`Configuring: ${menu.name}`)
    .setDescription(menu.desc)
    .addFields(
      { name: "Menu ID", value: `\`${menuIdValue}\``, inline: true },
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

  // Add webhook status to embed
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
        : "N/A (Webhook Disabled)", // Explicitly show N/A when disabled
      inline: true
    }
  );

  // --- Buttons for Publishing and Deleting (Row 1) ---
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

  // --- Role Type Toggles & Management (Row 2) ---
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
      .setDisabled(!menu.selectionType.includes("dropdown")), // Only enable if dropdown type is set
    new ButtonBuilder()
      .setCustomId(`rr:manage_roles:button:${menuId}`)
      .setLabel("Manage Button Roles")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!menu.selectionType.includes("button")) // Only enable if button type is set
  );

  // --- Emojis & Reordering (Row 3) ---
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
      .setDisabled(menu.buttonRoles.length <= 1)
  );

  // --- Limits, Exclusions, Descriptions (Row 4) ---
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
      .setDisabled(!menu.dropdownRoles.length)
  );

  // --- Customization & Webhook (Row 5) ---
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
      .setStyle(ButtonStyle.Primary)
  );

  if (menu.useWebhook) {
    row_customization_webhook.addComponents(
      new ButtonBuilder()
        .setCustomId(`rr:toggle_webhook:${menuId}`)
        .setLabel("Disable Webhook")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`rr:config_webhook:${menuId}`)
        .setLabel("Configure Branding")
        .setStyle(ButtonStyle.Primary)
    );
  } else {
    row_customization_webhook.addComponents(
      new ButtonBuilder()
        .setCustomId(`rr:toggle_webhook:${menuId}`)
        .setLabel("Enable Webhook")
        .setStyle(ButtonStyle.Success)
    );
  }

  const finalComponents = [
    row_publish_delete,
    row_role_types_and_management,
    row_emojis_reorder,
    row_limits_exclusions_descriptions,
    row_customization_webhook,
  ].filter(row => row.components.length > 0); // Ensure no empty rows are added

  try {
    await interaction.editReply({ embeds: [embed], components: finalComponents, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error("Error displaying menu configuration:", error);
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
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.editReply({ content: "Menu not found.", flags: MessageFlags.Ephemeral });

  // Ensure there are roles configured for the selected type(s) before publishing
  if (!menu.selectionType.length || (!menu.dropdownRoles.length && !menu.buttonRoles.length)) {
      return interaction.editReply({ content: "❌ Cannot publish: Please configure at least one role for either dropdown or button type.", flags: MessageFlags.Ephemeral });
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
        label: role.name.substring(0, 100),
        value: role.id,
        emoji: parseEmoji(menu.dropdownEmojis[role.id]),
        description: menu.dropdownRoleDescriptions[role.id] ? menu.dropdownRoleDescriptions[role.id].substring(0, 100) : undefined,
        default: false // Always set default to false so roles are not pre-selected
      };
    }).filter(Boolean); // Filter out any nulls from roles not found

    if (dropdownOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`rr-role-select:${menuId}`)
        .setPlaceholder("Select your roles...")
        .setMinValues(0)
        .setMaxValues(dropdownOptions.length)
        .addOptions(dropdownOptions);
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }
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
        .setLabel(role.name.substring(0, 80))
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
        if (buttonRows.length >= 4) break; // Max 5 rows total, leave 1 for dropdown
      }
    }
    if (currentRow.components.length > 0 && buttonRows.length < 4) {
      buttonRows.push(currentRow);
    }
    components.push(...buttonRows);
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
      flags: MessageFlags.Ephemeral
    });
    // After publishing, update the configuration view to reflect the published status
    return showMenuConfiguration(interaction, menuId);
  } catch (error) {
    console.error("Publishing error:", error);
    let errorMsg = "❌ Failed to publish menu. ";

    if (error.code === 50013) { // Missing Permissions
      errorMsg += "Bot lacks permissions. Required: 'Manage Webhooks' and 'Send Messages' in the channel, and 'Manage Roles' in the guild.";
    } else if (error.code === 50035) { // Invalid Form Body
      errorMsg += "Invalid component data. Please check your role configurations and emoji formats.";
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
