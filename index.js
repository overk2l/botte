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
} = require("discord.js");

// Firebase Imports
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, getDocs } = require('firebase/firestore');

// Initialize Firebase (using environment variables)
// You can set APP_ID in your .env or PM2 config if needed, otherwise 'default-app-id'
const appId = process.env.APP_ID || 'default-app-id'; // <--- CHANGED: Now uses process.env.APP_ID
let firebaseConfig = {};
try {
  // Expecting FIREBASE_CONFIG to be a JSON string in process.env
  if (process.env.FIREBASE_CONFIG) { // <--- CRUCIAL CHANGE: Now uses process.env.FIREBASE_CONFIG
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  } else {
    console.warn("[Firebase Init Warning] FIREBASE_CONFIG environment variable is not set. Using dummy projectId.");
  }
} catch (e) {
  console.error("[Firebase Init Error] Could not parse FIREBASE_CONFIG:", e); // <--- CHANGED: Error message reflects new var
  firebaseConfig = {}; // Fallback to an empty config if parsing fails
}

// Ensure projectId is present, even if it's a placeholder for debugging
if (!firebaseConfig.projectId) {
  console.error("[Firebase Init Error] 'projectId' is missing from firebaseConfig. Please ensure FIREBASE_CONFIG is correctly provided by the environment."); // <--- CHANGED THIS LINE
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
    // Only attempt to load if a valid projectId is available
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
      // This will catch the PERMISSION_DENIED error and prevent bot from crashing
    }
  },

  async createMenu(guildId, name, desc) {
    // Generate a more unique ID
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

    // Only attempt to save if a valid projectId is available
    if (firebaseConfig.projectId === 'missing-project-id') {
      console.warn("[Firestore] Skipping menu creation: projectId is missing or invalid. Please configure Firebase.");
      // Create in-memory only for immediate testing, won't persist
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

    // Only attempt to save if a valid projectId is available
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
        guildMenus.splice(index, 1); // Corrected: Use splice(index, 1) to remove the correct element
      }
    }
    this.menuData.delete(menuId);

    // Only attempt to delete if a valid projectId is available
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

  for (const [regionName, regionData] of Object.entries(menu.regionalLimits)) {
    const { limit, roleIds } = regionData;
    if (!limit || !roleIds || !roleIds.length) continue;

    const newRegionRoles = roleIds.filter(roleId => newRoleIds.includes(roleId));

    if (newRegionRoles.length > limit) {
      violations.push(`You can only select ${limit} role(s) from the ${regionName} region.`);
    }
  }

  return violations;
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
              content: "❌ Failed to delete message. Message ID cleared.",
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

      // Handle user-facing reaction role assignments (not dashboard)
      if (ctx === "assign") {
        const menuId = action; // For user assignments, action is the menuId
        const roleId = parts[2];
        const isButtonClear = parts[3] === 'clear_all'; // Check if it's the clear_all button

        return handleRoleAssignment(interaction, menuId, roleId, isButtonClear);
      }
    }


    // StringSelectMenu Handling (User and Dashboard)
    if (interaction.isStringSelectMenu()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      let type; // e.g., 'dropdown', 'button', or 'triggerRoleId'
      let menuId;

      if (action === "select_roles_user") { // User-facing select menu for role assignment
        menuId = parts[2]; // menuId is now parts[2]
        const selectedRoleIds = interaction.values;
        return handleRoleAssignment(interaction, menuId, selectedRoleIds, false, true); // The true here indicates it's a select menu
      }


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
          type = parts[2]; // 'dropdown' or 'button'
          menuId = parts[3]; // menuId is at parts[3]
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
          type = action.split("_")[1]; // "dropdown" or "button"
          menuId = parts[3]; // menuId is at parts[3]
          await db.saveRoleOrder(menuId, currentOrder, type);
          await interaction.editReply({ content: `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} role order saved!`, components: [] });
          return showMenuConfiguration(interaction, menuId);
        }

        if (action === "select_trigger_role") {
          const triggerRoleId = interaction.values[0];
          menuId = parts[2]; // menuId is at parts[2]
          const menu = db.getMenu(menuId);
          if (!menu) {
            return interaction.editReply({ content: "Menu not found. Please re-select the menu.", components: [], ephemeral: true });
          }
          const allRoles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id && r.id !== triggerRoleId);

          if (!allRoles.size) {
            return interaction.editReply({ content: "No other roles available to set as exclusions for this trigger role.", components: [], ephemeral: true });
          }

          const selectExclusionRoles = new StringSelectMenuBuilder()
            .setCustomId(`rr:select_exclusion_roles:${triggerRoleId}:${menuId}`)
            .setPlaceholder(`Select roles to exclude when ${interaction.guild.roles.cache.get(triggerRoleId).name} is picked...`)
            .setMinValues(0)
            .setMaxValues(Math.min(allRoles.size, 25))
            .addOptions(allRoles.map((r) => ({
              label: r.name,
              value: r.id,
              default: (menu.exclusionMap?.[triggerRoleId] || []).includes(r.id) // Pre-select current exclusions
            })));

          return interaction.editReply({
            content: `Now select roles to be **removed** when <@&${triggerRoleId}> is added:`,
            components: [new ActionRowBuilder().addComponents(selectExclusionRoles)],
            ephemeral: true
          });
        }

        if (action === "select_exclusion_roles") {
          const triggerRoleId = parts[2];
          menuId = parts[3]; // menuId is at parts[3]
          const selectedExclusionRoleIds = interaction.values; // These are the roles to be excluded
          await db.saveExclusionRoles(menuId, triggerRoleId, selectedExclusionRoleIds);
          await interaction.editReply({
            content: `✅ Exclusion roles saved for <@&${triggerRoleId}>.`,
            components: [],
            ephemeral: true
          });
          return showMenuConfiguration(interaction, menuId);
        }
      }
    }


    // Modal Submission Handling
    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");
      const ctx = parts[0];
      const action = parts[1];
      const type = parts[2]; // 'create', 'addemoji', 'setlimits', etc.
      const menuId = parts[3]; // For actions other than 'create', this will be the menuId

      if (ctx === "rr" && action === "modal") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.editReply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        if (type === "create") {
          const name = interaction.fields.getTextInputValue("name");
          const desc = interaction.fields.getTextInputValue("desc");
          const newMenuId = await db.createMenu(name, desc);
          console.log(`[Firebase] Created new menu with ID: ${newMenuId}`);

          await interaction.editReply({ content: `✅ Menu **${name}** created with ID: \`${newMenuId}\`.`, ephemeral: true });
          return showMenuConfiguration(interaction, newMenuId);
        }

        if (type === "addemoji") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const emojis = {};
          for (const fieldId of interaction.fields.fields.keys()) {
            emojis[fieldId] = interaction.fields.getTextInputValue(fieldId);
          }
          await db.saveEmojis(menuId, emojis, parts[2]); // parts[2] is the type ('dropdown' or 'button')
          await interaction.editReply({ content: "✅ Emojis saved!", ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }

        if (type === "setlimits") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const auLimit = parseInt(interaction.fields.getTextInputValue("au_limit")) || 0;
          const euLimit = parseInt(interaction.fields.getTextInputValue("eu_limit")) || 0;
          const naLimit = parseInt(interaction.fields.getTextInputValue("na_limit")) || 0;
          const maxRolesLimit = parseInt(interaction.fields.getTextInputValue("max_roles_limit")) || 0;
          let regionalRoleAssignments = {};
          try {
            const jsonInput = interaction.fields.getTextInputValue("regional_role_assignments");
            if (jsonInput) {
              regionalRoleAssignments = JSON.parse(jsonInput);
            }
          } catch (e) {
            console.error("Error parsing regional role assignments JSON:", e);
            return interaction.editReply({ content: "❌ Invalid JSON for Regional Role Assignments. Please use a valid JSON format.", ephemeral: true });
          }

          const regionalLimits = {
            AU: { limit: auLimit, roleIds: regionalRoleAssignments.AU || [] },
            EU: { limit: euLimit, roleIds: regionalRoleAssignments.EU || [] },
            NA: { limit: naLimit, roleIds: regionalRoleAssignments.NA || [] },
          };

          await db.saveLimits(menuId, regionalLimits, maxRolesLimit);
          await interaction.editReply({ content: "✅ Limits and regional assignments saved!", ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }

        if (type === "customize_embed") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const embedColor = interaction.fields.getTextInputValue("embed_color");
          const thumbnailUrl = interaction.fields.getTextInputValue("thumbnail_url");
          const imageUrl = interaction.fields.getTextInputValue("image_url");
          const authorName = interaction.fields.getTextInputValue("author_name");
          const authorIconURL = interaction.fields.getTextInputValue("author_icon_url");

          await db.saveEmbedCustomizations(menuId, {
            embedColor,
            embedThumbnail: thumbnailUrl,
            embedImage: imageUrl,
            embedAuthorName: authorName,
            embedAuthorIconURL: authorIconURL,
          });
          await interaction.editReply({ content: "✅ Embed appearance saved!", ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }

        if (type === "customize_footer") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const footerText = interaction.fields.getTextInputValue("footer_text");
          const footerIconURL = interaction.fields.getTextInputValue("footer_icon_url");

          await db.saveEmbedCustomizations(menuId, {
            embedFooterText: footerText,
            embedFooterIconURL: footerIconURL,
          });
          await interaction.editReply({ content: "✅ Embed footer saved!", ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }

        if (type === "webhook_branding") {
          if (!menuId) return interaction.editReply({ content: "Menu ID missing.", ephemeral: true });
          const webhookName = interaction.fields.getTextInputValue("name");
          const webhookAvatar = interaction.fields.getTextInputValue("avatar");

          await db.saveWebhookSettings(menuId, {
            webhookName,
            webhookAvatar,
          });
          await interaction.editReply({ content: "✅ Webhook branding saved!", ephemeral: true });
          return showMenuConfiguration(interaction, menuId);
        }
      }
    }
  } catch (error) {
    console.error("Error during interaction:", error);
    // Attempt to send an error message if the interaction hasn't been replied to or deferred
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "An unexpected error occurred while processing your request.", ephemeral: true }).catch(e => console.error("Error replying to interaction after catch:", e));
    } else {
      // If already deferred or replied, use followUp or editReply
      await interaction.followUp({ content: "An unexpected error occurred while processing your request.", ephemeral: true }).catch(e => console.error("Error following up after catch:", e));
    }
  }
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
                    content: "❌ Failed to delete message. Message ID cleared.",
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

          const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
          if (!roles.length) return interaction.editReply({ content: `No roles found for ${type}.`, ephemeral: true });

          const modal = new ModalBuilder().setCustomId(`rr:modal:addemoji:${type}:${menuId}`).setTitle(`Add Emojis for ${type}`);

          const maxInputs = Math.min(roles.length, 5);
          for (let i = 0; i < maxInputs; i++) {
            const roleId = roles[i];
            const role = interaction.guild.roles.cache.get(roleId);
            const currentEmoji = type === "dropdown" ? menu.dropdownEmojis[roleId] : menu.buttonEmojis[roleId];
            modal.addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(roleId)
                  .setLabel(`Emoji for ${role ? role.name : "Unknown Role"}`)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("Enter emoji (🔥 or <:name:id>)")
                  .setValue(currentEmoji || "")
              )
            );
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
                  .setValue(menu.regionalLimits.AU?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("eu_limit")
                  .setLabel("Limit For EU Roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits.EU?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("na_limit")
                  .setLabel("Limit For NA Roles")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("1")
                  .setRequired(false)
                  .setValue(menu.regionalLimits.NA?.limit?.toString() || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("regional_role_assignments")
                  .setLabel("Regional Role Assignments (JSON)")
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('{"AU": ["roleId1"], "EU": ["roleId2"], "NA": ["roleId3"]}')
                  .setRequired(false)
                  .setValue(JSON.stringify(Object.fromEntries(
                    Object.entries(menu.regionalLimits).map(([region, data]) => [region, data.roleIds || []])
                  )) || "")
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("max_roles_limit")
                  .setLabel("Max Roles Per Menu (0 for no limit)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("0")
                  .setValue(menu.maxRolesLimit !== null ? menu.maxRolesLimit.toString() : "")
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

      if (ctx === "rr") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.editReply({ content: "❌ You need Administrator permissions to configure reaction roles.", ephemeral: true });
        }

        // Defer update is already handled at the beginning of interactionCreate
        // await interaction.deferUpdate(); // REMOVED as it's now handled globally

        if (action === "modal") {
          if (modalType === "create") { // Use modalType instead of extra
            const name = interaction.fields.getTextInputValue("name");
            const desc = interaction.fields.getTextInputValue("desc");
            const newMenuId = await db.createMenu(interaction.guild.id, name, desc); // Await creation
            return showMenuConfiguration(interaction, newMenuId);
          }
        }
        // Consolidated modal handlers to use currentMenuId
        if (action === "addemoji") {
            const type = parts[3];
            const menu = db.getMenu(currentMenuId);
            if (!menu) {
                return interaction.followUp({ content: "Menu not found.", ephemeral: true });
            }

            const newEmojis = {};
            const roles = type === "dropdown" ? menu.dropdownRoles : menu.buttonRoles;
            for (const roleId of roles) {
              const emojiInput = interaction.fields.getTextInputValue(roleId);
              if (emojiInput) {
                newEmojis[roleId] = emojiInput;
              } else {
                delete newEmojis[roleId];
              }
            }
            await db.saveEmojis(currentMenuId, newEmojis, type);
            return showMenuConfiguration(interaction, currentMenuId);
        }
        if (action === "setlimits") {
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

        if (action === "customize_embed") {
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

        if (action === "customize_footer") {
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
        if (action === "custom_messages") {
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

        if (action === "role_description") {
            const roleId = parts[4];
            const menu = db.getMenu(currentMenuId);
            if (!menu) {
                return interaction.followUp({ content: "Menu not found.", ephemeral: true });
            }
            const description = interaction.fields.getTextInputValue("description_input");
            await db.saveRoleDescriptions(currentMenuId, { [roleId]: description || null });
            return showMenuConfiguration(interaction, currentMenuId);
        }

        if (action === "webhook_branding") {
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

    // Role adding/removing on select menu or button press
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rr-role-select:") || interaction.isButton() && interaction.customId.startsWith("rr-role-button:")) {
        const menuId = interaction.customId.split(":")[1];
        const menu = db.getMenu(menuId);
        if (!menu) return interaction.editReply({ content: "❌ This reaction role menu is no longer valid.", ephemeral: true });

        const selectedRoleIds = interaction.isStringSelectMenu() ? interaction.values : [interaction.customId.split(":")[2]];

        let rolesToAdd = [];
        let rolesToRemove = [];
        let messages = [];

        // Handle exclusions first
        for (const roleId of selectedRoleIds) {
          const exclusions = menu.exclusionMap[roleId];
          if (exclusions && exclusions.length > 0) {
            for (const excludedRoleId of exclusions) {
              if (interaction.member.roles.cache.has(excludedRoleId)) {
                rolesToRemove.push(excludedRoleId);
                messages.push(`Removed <@&${excludedRoleId}> due to exclusion.`);
              }
            }
          }
        }

        // Apply new roles and check limits
        const currentMenuRoles = (menu.dropdownRoles || []).concat(menu.buttonRoles || []);
        const memberRolesFromThisMenu = interaction.member.roles.cache.filter(role => currentMenuRoles.includes(role.id));
        const newRolesCount = selectedRoleIds.filter(roleId => !memberRolesFromThisMenu.has(roleId)).length;
        const totalRolesAfterAdd = memberRolesFromThisMenu.size + newRolesCount - rolesToRemove.length; // Approximate total after exclusions

        // Check max roles limit
        if (menu.maxRolesLimit !== null && menu.maxRolesLimit > 0 && totalRolesAfterAdd > menu.maxRolesLimit) {
            return interaction.editReply({ content: menu.limitExceededMessage, ephemeral: true });
        }

        // Check regional limits
        const currentMemberRoleIds = interaction.member.roles.cache.map(r => r.id);
        const rolesToBeAddedFinal = selectedRoleIds.filter(roleId => !currentMemberRoleIds.includes(roleId) && !rolesToRemove.includes(roleId));
        const combinedRolesForLimitCheck = [...currentMemberRoleIds.filter(id => !rolesToRemove.includes(id)), ...rolesToBeAddedFinal];

        const regionalViolations = checkRegionalLimits(interaction.member, menu, combinedRolesForLimitCheck);
        if (regionalViolations.length > 0) {
            return interaction.editReply({ content: regionalViolations.join("\n"), ephemeral: true });
        }

        for (const roleId of selectedRoleIds) {
          if (interaction.member.roles.cache.has(roleId)) {
            // Role exists, remove it
            if (!rolesToRemove.includes(roleId)) { // Don't add to remove if already marked by exclusion
              rolesToRemove.push(roleId);
              messages.push(menu.successMessageRemove.replace("{roleId}", roleId));
            }
          } else {
            // Role doesn't exist, add it
            if (!rolesToAdd.includes(roleId)) { // Don't add to add if it's going to be removed by exclusion
              rolesToAdd.push(roleId);
              messages.push(menu.successMessageAdd.replace("{roleId}", roleId));
            }
          }
        }

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
        } catch (error) {
          console.error("Error updating roles:", error);
          if (error.code === 50013) {
              await interaction.editReply({ content: "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.", ephemeral: true });
          } else {
              await interaction.editReply({ content: "❌ There was an error updating your roles.", ephemeral: true });
          }
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("rr-clear-roles:")) {
      const menuId = interaction.customId.split(":")[1];
      const menu = db.getMenu(menuId);
      if (!menu) return interaction.editReply({ content: "❌ This reaction role menu is no longer valid.", ephemeral: true });

      const allMenuRoleIds = [...menu.dropdownRoles, ...menu.buttonRoles];
      const rolesToRemove = interaction.member.roles.cache.filter(role => allMenuRoleIds.includes(role.id)).map(role => role.id);

      if (rolesToRemove.length === 0) {
        return interaction.editReply({ content: "You don't have any roles from this menu to clear.", ephemeral: true });
      }

      try {
        await interaction.member.roles.remove(rolesToRemove);
        await interaction.editReply({ content: "✅ All roles from this menu have been cleared.", ephemeral: true });
      } catch (error) {
        console.error("Error clearing roles:", error);
        if (error.code === 50013) {
            await interaction.editReply({ content: "❌ I don't have permission to manage these roles. Please check my role permissions and ensure my role is above the roles I need to manage.", ephemeral: true });
        } else {
        await interaction.editReply({ content: "❌ There was an error clearing your roles.", ephemeral: true });        }
      }
    }

  } catch (error) {
    console.error("Error handling interaction:", error);
    if (!interaction.replied && !interaction.deferred) {
      // If an error occurs before defer or reply, send a fresh reply
      await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
    } else if (interaction.deferred) {
      // If deferred, but an error occurred before editing, edit the reply
      await interaction.editReply({ content: "❌ Something went wrong after deferring. Please try again.", ephemeral: true }).catch(e => console.error("Error editing deferred reply:", e));
    }
  }
});

// --- Dashboard Functions ---

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
  // Use editReply now that interaction is deferred
  await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });
}

async function showReactionRolesDashboard(interaction) {
  console.log("[showReactionRolesDashboard] Function called.");
  const menus = db.getMenus(interaction.guild.id);
  console.log(`[showReactionRolesDashboard] Found ${menus.length} menus.`);

  const embed = new EmbedBuilder()
    .setTitle("Reaction Role Menus")
    .setDescription("Manage your reaction role menus here. Create new ones or configure existing.")
    .setColor("#5865F2");

  const components = [];

  // Only add the select menu if there are existing menus
  if (menus.length > 0) {
    const menuOptions = menus.map((menu) => ({ label: menu.name, value: menu.id }));
    console.log(`[showReactionRolesDashboard] Generated ${menuOptions.length} select menu options.`);
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("rr:selectmenu")
      .setPlaceholder("Select a menu to configure...")
      .addOptions(menuOptions);
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  } else {
    embed.setDescription("No reaction role menus found. Create a new one!");
    console.log("[showReactionRolesDashboard] No menus found, omitting select menu.");
  }

  const createButton = new ButtonBuilder()
    .setCustomId("rr:create")
    .setLabel("Create New Menu")
    .setStyle(ButtonStyle.Success)
    .setEmoji("➕"); // Added emoji

  const backButton = new ButtonBuilder()
    .setCustomId("dash:back")
    .setLabel("Back to Dashboard")
    .setStyle(ButtonStyle.Secondary);

  components.push(new ActionRowBuilder().addComponents(createButton, backButton));

  try {
    console.log(`[showReactionRolesDashboard] Attempting to update interaction with ${components.length} components.`);
    // Use editReply now that interaction is deferred
    await interaction.editReply({ embeds: [embed], components, ephemeral: true });
    console.log("[showReactionRolesDashboard] Interaction updated successfully.");
  } catch (error) {
    console.error("[showReactionRolesDashboard] Error updating interaction:", error);
    // If an error occurs after deferring, use editReply
    await interaction.editReply({ content: "❌ Something went wrong while displaying the reaction roles dashboard.", ephemeral: true }).catch(e => console.error("Error editing deferred reply:", e));
  }
}

async function showMenuConfiguration(interaction, menuId) {
  // Add validation at the start of the function
  if (!menuId || typeof menuId !== 'string' || menuId.length < 5) {
    console.error(`Invalid menuId: ${menuId}`);
    // Use editReply as interaction is now deferred globally
    return interaction.editReply({
      content: "❌ Invalid menu configuration. Please recreate the menu or select a valid one from the dashboard.",
      ephemeral: true
    }).catch(e => console.error("Error editing deferred reply for invalid menuId:", e));
  }

  console.log(`[showMenuConfiguration] Function called for menuId: ${menuId}`);
  const menu = db.getMenu(menuId);
  if (!menu) {
    console.error(`[showMenuConfiguration] Menu not found for ID: ${menuId}`);
    // Use editReply as interaction is now deferred globally
    return interaction.editReply({ content: "Menu not found.", ephemeral: true }).catch(e => console.error("Error editing deferred reply:", e));
  }
  console.log(`[showMenuConfiguration] Menu data retrieved for ${menu.name}.`);

  const embed = new EmbedBuilder()
    .setTitle(`Configuring: ${menu.name}`)
    .setDescription(menu.desc)
    .addFields(
      { name: "Menu ID", value: `\`${menu.id}\``, inline: true },
      { name: "Dropdown Roles", value: menu.dropdownRoles.length > 0 ? menu.dropdownRoles.map((r) => `<@&${r}>`).join(", ") : "None", inline: false },
      { name: "Button Roles", value: menu.buttonRoles.length > 0 ? menu.buttonRoles.map((r) => `<@&${r}>`).join(", ") : "None", inline: false },
      { name: "Selection Type", value: menu.selectionType.join(" & ") || "Not set", inline: true },
      { name: "Published", value: menu.messageId ? `✅ Yes in <#${menu.channelId}>` : "❌ No", inline: true },
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
  console.log("[showMenuConfiguration] row1_role_types created.");

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
  console.log("[showMenuConfiguration] row2_emojis_reorder created.");

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
      .setDisabled(!menu.dropdownRoles.length) // Only applies to dropdown for now
  );
  console.log("[showMenuConfiguration] row3_limits_exclusions_descriptions created.");

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
  console.log("[showMenuConfiguration] row4_customize_messages_webhook created.");

  // Clear role buttons as simple toggles (buttons instead of select menus)
  const row5_clear_buttons_toggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:toggle_dropdown_clear_button:${menuId}:${!menu.enableDropdownClearRolesButton}`)
      .setLabel(`Dropdown Clear: ${menu.enableDropdownClearRolesButton ? '✅ Enabled' : '❌ Disabled'}`)
      .setStyle(menu.enableDropdownClearRolesButton ? ButtonStyle.Success : ButtonStyle.Danger)
      .setDisabled(!menu.selectionType.includes("dropdown")), // Disable if not relevant for dropdown
    new ButtonBuilder()
      .setCustomId(`rr:toggle_button_clear_button:${menuId}:${!menu.enableButtonClearRolesButton}`)
      .setLabel(`Button Clear: ${menu.enableButtonClearRolesButton ? '✅ Enabled' : '❌ Disabled'}`)
      .setStyle(menu.enableButtonClearRolesButton ? ButtonStyle.Success : ButtonStyle.Danger)
      .setDisabled(!menu.selectionType.includes("button")) // Disable if not relevant for button
  );
  console.log("[showMenuConfiguration] row5_clear_buttons_toggles created.");


  const row_publish_back = new ActionRowBuilder().addComponents(
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
      .setLabel("Delete Published Menu")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!menu.messageId), // Disable if not already published
    new ButtonBuilder()
      .setCustomId("dash:reaction-roles")
      .setLabel("Back to RR Dashboard")
      .setStyle(ButtonStyle.Secondary)
  );
  console.log("[showMenuConfiguration] row_publish_back created.");


  // Collect all potential rows and filter out empty ones, then slice to 5
  const allPossibleRows = [
    row1_role_types,
    row2_emojis_reorder,
    row3_limits_exclusions_descriptions,
    row4_customize_messages_webhook,
    row5_clear_buttons_toggles,
    row_publish_back // This will be the 6th row, so it will be truncated if all others are present
  ];

  const finalComponents = allPossibleRows.filter(row => row.components.length > 0).slice(0, 5);
  console.log(`[showMenuConfiguration] Total final components to send: ${finalComponents.length}.`);

  try {
    // Use editReply now that interaction is deferred globally
    await interaction.editReply({ embeds: [embed], components: finalComponents, ephemeral: true });
    console.log("[showMenuConfiguration] Interaction response sent successfully.");
  } catch (error) {
    console.error("Error during interaction response:", error);
    // If an error occurs after deferring, use editReply
    await interaction.editReply({ content: "❌ Something went wrong while displaying the menu configuration.", ephemeral: true }).catch(e => console.error("Error editing deferred reply:", e));
  }
}

async function publishMenu(interaction, menuId, messageToEdit = null) {
  const menu = db.getMenu(menuId);
  if (!menu) return interaction.editReply({ content: "Menu not found.", ephemeral: true });

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

  const components = [];

  // Dropdown Select Menu
  if (menu.selectionType.includes("dropdown") && menu.dropdownRoles.length > 0) {
    const dropdownOptions = menu.dropdownRoleOrder.length > 0
      ? menu.dropdownRoleOrder.map(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        return {
          label: role.name,
          value: role.id,
          emoji: parseEmoji(menu.dropdownEmojis[role.id]),
          description: menu.dropdownRoleDescriptions[role.id] || undefined,
        };
      }).filter(Boolean)
      : menu.dropdownRoles.map(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return null;
        return {
          label: role.name,
          value: role.id,
          emoji: parseEmoji(menu.dropdownEmojis[role.id]),
          description: menu.dropdownRoleDescriptions[role.id] || undefined,
        };
      }).filter(Boolean);

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
        .setStyle(ButtonStyle.Secondary)
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

  // Clear button roles button
  if (menu.selectionType.includes("button") && menu.enableButtonClearRolesButton) {
    const clearButton = new ButtonBuilder()
      .setCustomId(`rr-clear-roles:${menuId}:button`)
      .setLabel("Clear All Button Roles")
      .setStyle(ButtonStyle.Secondary);
    components.push(new ActionRowBuilder().addComponents(clearButton));
  }

  try {
    // Delete old message if exists and it's a fresh publish (not an edit)
    if (menu.messageId && !messageToEdit) {
      try {
        const oldChannel = interaction.guild.channels.cache.get(menu.channelId);
        if (oldChannel) {
          const oldMessage = await oldChannel.messages.fetch(menu.messageId);
          await oldMessage.delete();
        }
      } catch (error) {
        console.log("Couldn't delete old message, probably already deleted or not found.");
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
      // WEBHOOK MODE: Custom branding + functional components
      const webhook = await getOrCreateWebhook(interaction.channel);

      message = await webhook.send({
        embeds: [embed],
        components,
        username: menu.webhookName || interaction.guild.me.displayName,
        avatarURL: menu.webhookAvatar || interaction.guild.me.displayAvatarURL(),
      });
    } else {
      // REGULAR MODE: Standard bot message
      message = await interaction.channel.send({
        embeds: [embed],
        components
      });
    }

    await db.saveMessageId(menuId, interaction.channel.id, message.id);
    // Use editReply now that interaction is deferred globally
    await interaction.editReply({
      content: `✅ Menu published successfully using ${menu.useWebhook ? "WEBHOOK" : "BOT"}!`,
      ephemeral: true
    });
  } catch (error) {
    console.error("Publishing error:", error);
    let errorMsg = "❌ Failed to publish menu. ";

    if (error.code === 50013) {
      errorMsg += "Bot lacks permissions. Required: 'Manage Webhooks' and 'Send Messages'";
    } else if (error.message.includes("ENOENT")) {
      errorMsg += "Invalid image URL or resource not found.";
    } else {
      errorMsg += error.message;
    }

    // Use editReply now that interaction is deferred globally
    await interaction.editReply({ content: errorMsg, ephemeral: true });
  }
}

client.login(process.env.TOKEN);
