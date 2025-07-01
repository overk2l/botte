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
  EmbedBuilder,
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

// Slash command data
const commands = [
  new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Send customizable reaction role menu'),
].map(cmd => cmd.toJSON());

// Register slash commands
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

// Customize embed content here:
const embedConfig = {
  title: "Choose Your Colour & Ping Roles!・⇲",
  description: 
    "✨ Express yourself with a custom color! ✨\nChoose the color that best fits your vibe — you can change it anytime below.\n\n" +
    "Notification Roles – Stay updated with what matters:\n" +
    "📢 ・➤ Announcement Ping — Get pings for updates.\n" +
    "⚔️ ・➤ War Ping — Get pinged for a war.\n" +
    "🧑🏻‍🤝‍🧑🏻 ・➤ Teamer Ping — Get pinged for teamers.\n\n" +
    "⬇️ Choose colour & ping roles below! ⬇️",
  color: 0x0099ff, // Change this to any hex color (0xRRGGBB)
  imageUrl: null, // Set to a valid image URL or null
};

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'reactionrole') {
    // Fetch the guild roles fresh:
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });

    await guild.roles.fetch();

    // Filter roles by some criteria — for example, exclude @everyone and bots:
    const allRoles = guild.roles.cache.filter(r => r.id !== guild.id && !r.managed);

    // You can filter roles by name or color to decide which go in color roles or notification roles:
    // For example:
    const colorRoles = allRoles.filter(r => ['red', 'blue', 'green'].some(c => r.name.toLowerCase().includes(c)));
    const notifRoles = allRoles.filter(r => ['announcement', 'war', 'teamer'].some(w => r.name.toLowerCase().includes(w)));

    // Build color roles options for dropdown
    const colorOptions = colorRoles.map(r => ({
      label: r.name,
      value: r.id,
      description: `Get the ${r.name} role`,
      // You can assign emoji by color if you want, or leave empty:
      emoji: getEmojiByRoleName(r.name),
    }));

    // Build notification roles buttons
    const notifButtons = notifRoles.map(r => 
      new ButtonBuilder()
        .setCustomId(r.id)
        .setLabel(r.name)
        .setStyle(ButtonStyle.Primary) // You can pick styles dynamically if you want
    );

    // Create dropdown menu for color roles
    const colorSelectMenu = new StringSelectMenuBuilder()
      .setCustomId('color_roles')
      .setPlaceholder('🎨 Select a colour...')
      .addOptions(colorOptions)
      .setMinValues(1)
      .setMaxValues(colorOptions.length);

    const colorRow = new ActionRowBuilder().addComponents(colorSelectMenu);
    const buttonRow = new ActionRowBuilder().addComponents(notifButtons);

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle(embedConfig.title)
      .setDescription(embedConfig.description)
      .setColor(embedConfig.color);

    if (embedConfig.imageUrl) {
      embed.setImage(embedConfig.imageUrl);
    }

    await interaction.reply({ embeds: [embed], components: [colorRow, buttonRow], ephemeral: false });
  }

  // Role add/remove on interaction
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

// Helper to assign emoji by role name (simple example)
function getEmojiByRoleName(name) {
  name = name.toLowerCase();
  if (name.includes('red')) return '🔴';
  if (name.includes('blue')) return '🔵';
  if (name.includes('green')) return '🟢';
  return null;
}

client.login(process.env.TOKEN);
