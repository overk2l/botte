const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  Routes,
  REST,
} = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// --- Slash command data ---
const commands = [
  new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Send the reaction role menu'),
].map(command => command.toJSON());

// Register slash commands once on startup
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'reactionrole') {
      // Build embed
      const embed = {
        title: "Choose Your Colour & Ping Roles!・⇲",
        description:
          "✨ Express yourself with a custom color! ✨\nChoose the color that best fits your vibe — you can change it anytime below.\n\n" +
          "Notification Roles – Stay updated with what matters:\n" +
          "📢 ・➤ [Announcement Ping] — Get pings for updates.\n" +
          "⚔️ ・➤ [War Ping] — Get pinged for a war.\n" +
          "🧑🏻‍🤝‍🧑🏻 ・➤ [Teamer Ping] — Get pinged for teamers.\n\n" +
          "⬇️ Choose colour & ping roles below! ⬇️",
        color: 0x0099ff,
      };

      // Customize these role IDs to match your server's actual role IDs:
      const COLOR_ROLES = [
        { label: "Red", value: "ROLE_ID_FOR_RED", description: "Get the Red role", emoji: "🔴" },
        { label: "Blue", value: "ROLE_ID_FOR_BLUE", description: "Get the Blue role", emoji: "🔵" },
        { label: "Green", value: "ROLE_ID_FOR_GREEN", description: "Get the Green role", emoji: "🟢" },
      ];

      const NOTIF_ROLES = [
        { label: "Announcement Ping", id: "ROLE_ID_FOR_ANNOUNCEMENT", style: ButtonStyle.Primary },
        { label: "War Ping", id: "ROLE_ID_FOR_WAR", style: ButtonStyle.Secondary },
        { label: "Teamer Ping", id: "ROLE_ID_FOR_TEAMER", style: ButtonStyle.Success },
      ];

      // Build dropdown menu for color roles
      const colorSelectMenu = new StringSelectMenuBuilder()
        .setCustomId('color_roles')
        .setPlaceholder('🎨 Select a colour...')
        .addOptions(COLOR_ROLES)
        .setMinValues(1)
        .setMaxValues(COLOR_ROLES.length);

      // Build action rows
      const colorRow = new ActionRowBuilder().addComponents(colorSelectMenu);

      const buttonRow = new ActionRowBuilder().addComponents(
        NOTIF_ROLES.map(role => 
          new ButtonBuilder()
            .setCustomId(role.id)
            .setLabel(role.label)
            .setStyle(role.style)
        )
      );

      // Send the message
      await interaction.reply({ embeds: [embed], components: [colorRow, buttonRow], ephemeral: false });
    }
  }

  // Handle button and select menu interactions for roles
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const member = interaction.member;

    if (interaction.isButton()) {
      const roleId = interaction.customId;
      try {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
          await interaction.reply({ content: `Role removed!`, ephemeral: true });
        } else {
          await member.roles.add(roleId);
          await interaction.reply({ content: `Role added!`, ephemeral: true });
        }
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'I cannot manage that role.', ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu()) {
      const selectedRoleIds = interaction.values;
      const allOptions = interaction.component.options.map(o => o.value);
      const rolesToAdd = selectedRoleIds.filter(id => !member.roles.cache.has(id));
      const rolesToRemove = allOptions.filter(id => !selectedRoleIds.includes(id) && member.roles.cache.has(id));

      try {
        await member.roles.add(rolesToAdd);
        await member.roles.remove(rolesToRemove);
        await interaction.reply({ content: `Roles updated!`, ephemeral: true });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'I cannot update roles.', ephemeral: true });
      }
    }
  }
});

client.login(process.env.TOKEN);

