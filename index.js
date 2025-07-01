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

// Slash command data
const commands = [
  new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Create a customizable reaction role menu'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// Register commands on startup
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

client.on('interactionCreate', async interaction => {
  // Handle slash command
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'reactionrole') {
      // Fetch roles dynamically, exclude @everyone and managed roles
      const roles = interaction.guild.roles.cache
        .filter(role => !role.managed && role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position);

      const options = roles.map(role => ({
        label: role.name,
        value: role.id,
        description: `Assign yourself the ${role.name} role`,
      })).slice(0, 25); // Max 25 options in select menu

      if (options.length === 0) {
        return interaction.reply({ content: 'No assignable roles found.', ephemeral: true });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_roles')
        .setPlaceholder('Select roles to include in reaction menu (max 5)')
        .addOptions(options)
        .setMinValues(1)
        .setMaxValues(Math.min(5, options.length)); // Max 5 selections allowed

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.reply({
        content: 'Select which roles you want to include in the reaction role menu:',
        components: [row],
        ephemeral: true,
      });
    }
  }

  // Handle role selection from dropdown for setting up reaction roles
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_roles') {
    const selectedRoleIds = interaction.values; // roles you picked

    const embed = {
      title: 'Choose Your Roles!',
      description: 'Use the buttons or dropdown below to assign or remove roles.',
      color: 0x0099ff,
    };

    // Create buttons for each selected role (max 5)
    const buttons = selectedRoleIds.map(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      return new ButtonBuilder()
        .setCustomId(roleId)
        .setLabel(role.name)
        .setStyle(ButtonStyle.Primary);
    });

    // Dropdown menu with same roles
    const dropdownOptions = selectedRoleIds.map(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      return {
        label: role.name,
        value: role.id,
      };
    });

    const dropdownMenu = new StringSelectMenuBuilder()
      .setCustomId('role_dropdown')
      .setPlaceholder('Select roles to add or remove')
      .addOptions(dropdownOptions)
      .setMinValues(1)
      .setMaxValues(dropdownOptions.length);

    // Build action rows
    const buttonRow = new ActionRowBuilder().addComponents(buttons);
    const dropdownRow = new ActionRowBuilder().addComponents(dropdownMenu);

    // Send reaction role message to the channel (not ephemeral)
    await interaction.reply({ embeds: [embed], components: [buttonRow, dropdownRow], ephemeral: false });
  }

  // Handle button clicks for toggling roles
  if (interaction.isButton()) {
    const roleId = interaction.customId;
    const member = interaction.member;

    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ content: `Removed <@&${roleId}> role!`, ephemeral: true });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ content: `Added <@&${roleId}> role!`, ephemeral: true });
      }
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'I cannot manage that role.', ephemeral: true });
    }
  }

  // Handle dropdown role toggle
  if (interaction.isStringSelectMenu() && interaction.customId === 'role_dropdown') {
    const selectedRoleIds = interaction.values;
    const member = interaction.member;

    try {
      // Calculate roles to add/remove based on current roles
      const rolesToAdd = selectedRoleIds.filter(roleId => !member.roles.cache.has(roleId));
      const rolesToRemove = member.roles.cache
        .filter(role => selectedRoleIds.includes(role.id))
        .map(role => role.id)
        .filter(id => !rolesToAdd.includes(id));

      await member.roles.add(rolesToAdd);
      await member.roles.remove(rolesToRemove);

      await interaction.reply({ content: 'Roles updated!', ephemeral: true });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'I cannot update roles.', ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);
