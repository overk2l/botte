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
  InteractionType,
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

// Slash command registration
const commands = [
  new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Create a customizable reaction role menu'),
].map(cmd => cmd.toJSON());

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

// Temporary storage for interaction state (replace with DB for production)
const tempData = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'reactionrole') {
      // Ask style choice
      const styleMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_style')
          .setPlaceholder('Choose reaction role style')
          .addOptions([
            { label: 'Buttons', value: 'buttons' },
            { label: 'Dropdown', value: 'dropdown' },
          ])
      );

      await interaction.reply({ content: 'Select reaction role style:', components: [styleMenu], ephemeral: true });
    }
  }

  // Handle style select menu
  else if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'select_style') {
      const style = interaction.values[0];

      // Fetch all roles except @everyone and managed roles
      const roles = interaction.guild.roles.cache
        .filter(r => r.id !== interaction.guild.id && !r.managed && r.name !== '@everyone')
        .map(r => ({ label: r.name, value: r.id }))
        .slice(0, 25); // max 25 options

      if (!roles.length) {
        return interaction.update({ content: 'No roles available to assign.', components: [], ephemeral: true });
      }

      // Save selected style
      tempData.set(interaction.user.id, { style });

      // Show role selection menu
      const roleSelectMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_roles')
          .setPlaceholder('Select roles to add to reaction role menu')
          .setMinValues(1)
          .setMaxValues(roles.length)
          .addOptions(roles)
      );

      await interaction.update({ content: 'Select roles for the reaction role menu:', components: [roleSelectMenu], ephemeral: true });
    }

    // Handle role selection menu
    else if (interaction.customId === 'select_roles') {
      const selectedRoles = interaction.values; // array of role IDs
      const userData = tempData.get(interaction.user.id);

      if (!userData) {
        return interaction.reply({ content: 'Session expired, please try again.', ephemeral: true });
      }

      const style = userData.style || 'buttons';

      // Build embed
      const embed = new EmbedBuilder()
        .setTitle('Choose Your Roles!')
        .setDescription('Select roles by interacting with the buttons or dropdown below.')
        .setColor(0x0099ff);

      // Build components based on style and roles
      let components = [];

      if (style === 'buttons') {
        const row = new ActionRowBuilder();
        for (const roleId of selectedRoles) {
          const role = interaction.guild.roles.cache.get(roleId);
          if (role) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`rr_button_${roleId}`)
                .setLabel(role.name)
                .setStyle(ButtonStyle.Primary)
            );
          }
        }
        components.push(row);
      } else if (style === 'dropdown') {
        const options = selectedRoles.map(roleId => {
          const role = interaction.guild.roles.cache.get(roleId);
          return role ? { label: role.name, value: role.id } : null;
        }).filter(Boolean);

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('rr_dropdown')
            .setPlaceholder('Select roles...')
            .setMinValues(1)
            .setMaxValues(options.length)
            .addOptions(options)
        );

        components.push(row);
      }

      // Send the reaction role panel to the channel
      await interaction.update({ content: 'Reaction role panel created!', components: [], ephemeral: true });
      await interaction.channel.send({ embeds: [embed], components });

      // Clear temp data
      tempData.delete(interaction.user.id);
    }
  }

  // Handle button and dropdown role assignment
  else if (interaction.isButton()) {
    if (interaction.customId.startsWith('rr_button_')) {
      const roleId = interaction.customId.replace('rr_button_', '');
      const member = interaction.member;

      if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });

      try {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
          await interaction.reply({ content: `Removed role <@&${roleId}>`, ephemeral: true });
        } else {
          await member.roles.add(roleId);
          await interaction.reply({ content: `Added role <@&${roleId}>`, ephemeral: true });
        }
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'I cannot manage that role.', ephemeral: true });
      }
    }
  } else if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'rr_dropdown') {
      const member = interaction.member;
      const selectedRoleIds = interaction.values;

      if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });

      // Roles options in the dropdown
      const allRoleIds = interaction.component.options.map(opt => opt.value);

      const rolesToAdd = selectedRoleIds.filter(id => !member.roles.cache.has(id));
      const rolesToRemove = allRoleIds.filter(id => !selectedRoleIds.includes(id) && member.roles.cache.has(id));

      try {
        await member.roles.add(rolesToAdd);
        await member.roles.remove(rolesToRemove);
        await interaction.reply({ content: 'Your roles have been updated!', ephemeral: true });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'I cannot update roles.', ephemeral: true });
      }
    }
  }
});

client.login(process.env.TOKEN);
