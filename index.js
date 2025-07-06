const { Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Store for dropdown interactions
const activeMenus = new Map();

// Bot ready event
client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`🚀 Serving ${client.guilds.cache.size} servers`);
    console.log(`📝 Available commands: !test1, !test2, !test3, !test4`);
});

// Message handler for commands
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;
    
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    try {
        switch (command) {
            case 'test1':
                await handleTest1(message);
                break;
            case 'test2':
                await handleTest2(message);
                break;
            case 'test3':
                await handleTest3(message);
                break;
            case 'test4':
                await handleTest4(message);
                break;
            default:
                // Ignore unknown commands
                break;
        }
    } catch (error) {
        console.error(`Error executing command ${command}:`, error);
        await message.reply('❌ An error occurred while executing this command.');
    }
});

// Test 1: Basic Role Selection Menu
async function handleTest1(message) {
    const embed = new EmbedBuilder()
        .setTitle('🎭 Role Selection Menu')
        .setDescription('Select a role from the dropdown menu below:')
        .setColor(0x00AE86)
        .setFooter({ text: 'Choose wisely!' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('role_select_basic')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Gamer')
                .setDescription('For gaming enthusiasts')
                .setValue('gamer')
                .setEmoji('🎮'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Artist')
                .setDescription('For creative minds')
                .setValue('artist')
                .setEmoji('🎨'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Developer')
                .setDescription('For coding wizards')
                .setValue('developer')
                .setEmoji('💻'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Musician')
                .setDescription('For music lovers')
                .setValue('musician')
                .setEmoji('🎵'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 2: Multi-Select Role Menu
async function handleTest2(message) {
    const embed = new EmbedBuilder()
        .setTitle('🏷️ Multi-Role Selection')
        .setDescription('Select multiple roles at once!\n\n**Available Roles:**\n🔥 VIP - Special privileges\n⭐ Helper - Community assistant\n🌟 Supporter - Server supporter\n🎯 Event Organizer - Event planning')
        .setColor(0xFF6B6B)
        .setFooter({ text: 'You can select multiple options!' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('role_select_multi')
        .setPlaceholder('Choose roles...')
        .setMinValues(1)
        .setMaxValues(4)
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('VIP')
                .setDescription('Get VIP access and perks')
                .setValue('vip')
                .setEmoji('🔥'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Helper')
                .setDescription('Help other community members')
                .setValue('helper')
                .setEmoji('⭐'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Supporter')
                .setDescription('Show your support for the server')
                .setValue('supporter')
                .setEmoji('🌟'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Event Organizer')
                .setDescription('Organize community events')
                .setValue('event_organizer')
                .setEmoji('🎯')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 3: Category-Based Role Selection
async function handleTest3(message) {
    const embed = new EmbedBuilder()
        .setTitle('📋 Category Role Selection')
        .setDescription('Choose a category to see available roles:')
        .setColor(0x4ECDC4)
        .addFields(
            { name: '🎮 Gaming', value: 'Gaming-related roles', inline: true },
            { name: '🎨 Creative', value: 'Creative and artistic roles', inline: true },
            { name: '💼 Professional', value: 'Professional and work roles', inline: true }
        )
        .setFooter({ text: 'Select a category first!' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('category_select')
        .setPlaceholder('Choose a category...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Gaming')
                .setDescription('Gaming and esports roles')
                .setValue('gaming')
                .setEmoji('🎮'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Creative')
                .setDescription('Art, music, and creative roles')
                .setValue('creative')
                .setEmoji('🎨'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Professional')
                .setDescription('Work and professional roles')
                .setValue('professional')
                .setEmoji('💼')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 4: Color Role Selection
async function handleTest4(message) {
    const embed = new EmbedBuilder()
        .setTitle('🌈 Color Role Selection')
        .setDescription('Choose a color for your username!')
        .setColor(0x9B59B6)
        .setFooter({ text: 'Colors make everything better!' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('color_select')
        .setPlaceholder('Choose your color...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Red')
                .setDescription('Passionate and bold')
                .setValue('red')
                .setEmoji('🔴'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Blue')
                .setDescription('Cool and calm')
                .setValue('blue')
                .setEmoji('🔵'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Green')
                .setDescription('Natural and fresh')
                .setValue('green')
                .setEmoji('🟢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Purple')
                .setDescription('Royal and mysterious')
                .setValue('purple')
                .setEmoji('🟣'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Orange')
                .setDescription('Energetic and warm')
                .setValue('orange')
                .setEmoji('🟠'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Yellow')
                .setDescription('Bright and cheerful')
                .setValue('yellow')
                .setEmoji('🟡')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Handle dropdown interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;

    try {
        switch (interaction.customId) {
            case 'role_select_basic':
                await handleBasicRoleSelection(interaction);
                break;
            case 'role_select_multi':
                await handleMultiRoleSelection(interaction);
                break;
            case 'category_select':
                await handleCategorySelection(interaction);
                break;
            case 'color_select':
                await handleColorSelection(interaction);
                break;
            // Handle category sub-menus
            case 'gaming_roles':
            case 'creative_roles':
            case 'professional_roles':
                await handleSubcategoryRoles(interaction);
                break;
            default:
                await interaction.reply({ content: '❌ Unknown interaction!', ephemeral: true });
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        const errorMessage = '❌ An error occurred while processing your selection.';
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
});

// Handle basic role selection
async function handleBasicRoleSelection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'musician'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
            await interaction.reply({ content: '🗑️ All roles have been removed!', ephemeral: true });
        } else {
            await interaction.reply({ content: '❌ You don\'t have any roles to remove!', ephemeral: true });
        }
        return;
    }
    
    // Find or create the role
    const roleName = selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
    let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    
    if (!role) {
        const colors = { gamer: 0x00FF00, artist: 0xFF69B4, developer: 0x0099FF, musician: 0xFFFF00 };
        role = await interaction.guild.roles.create({
            name: roleName,
            color: colors[selectedRole] || 0x99AAB5,
            reason: 'Role selection menu'
        });
    }
    
    if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
        await interaction.reply({ content: `➖ Removed the **${roleName}** role!`, ephemeral: true });
    } else {
        await member.roles.add(role);
        await interaction.reply({ content: `➕ Added the **${roleName}** role!`, ephemeral: true });
    }
}

// Handle multi-role selection
async function handleMultiRoleSelection(interaction) {
    const selectedRoles = interaction.values;
    const member = interaction.member;
    const results = [];
    
    for (const roleValue of selectedRoles) {
        const roleName = roleValue.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        
        if (!role) {
            const colors = { vip: 0xFFD700, helper: 0x00FF7F, supporter: 0xFF6347, event_organizer: 0x9370DB };
            role = await interaction.guild.roles.create({
                name: roleName,
                color: colors[roleValue] || 0x99AAB5,
                reason: 'Multi-role selection menu'
            });
        }
        
        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role);
            results.push(`➕ Added **${roleName}**`);
        } else {
            results.push(`✅ Already have **${roleName}**`);
        }
    }
    
    await interaction.reply({ content: results.join('\n'), ephemeral: true });
}

// Handle category selection
async function handleCategorySelection(interaction) {
    const category = interaction.values[0];
    
    let embed, selectMenu;
    
    switch (category) {
        case 'gaming':
            embed = new EmbedBuilder()
                .setTitle('🎮 Gaming Roles')
                .setDescription('Select gaming-related roles:')
                .setColor(0x00FF00);
            
            selectMenu = new StringSelectMenuBuilder()
                .setCustomId('gaming_roles')
                .setPlaceholder('Choose gaming roles...')
                .setMinValues(1)
                .setMaxValues(3)
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel('FPS Player')
                        .setDescription('First-person shooter games')
                        .setValue('fps_player')
                        .setEmoji('🔫'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('RPG Player')
                        .setDescription('Role-playing games')
                        .setValue('rpg_player')
                        .setEmoji('⚔️'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Strategy Player')
                        .setDescription('Strategy and tactics games')
                        .setValue('strategy_player')
                        .setEmoji('🏰')
                ]);
            break;
            
        case 'creative':
            embed = new EmbedBuilder()
                .setTitle('🎨 Creative Roles')
                .setDescription('Select creative roles:')
                .setColor(0xFF69B4);
            
            selectMenu = new StringSelectMenuBuilder()
                .setCustomId('creative_roles')
                .setPlaceholder('Choose creative roles...')
                .setMinValues(1)
                .setMaxValues(3)
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Digital Artist')
                        .setDescription('Digital art and design')
                        .setValue('digital_artist')
                        .setEmoji('🖼️'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Photographer')
                        .setDescription('Photography enthusiast')
                        .setValue('photographer')
                        .setEmoji('📸'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Writer')
                        .setDescription('Creative writing')
                        .setValue('writer')
                        .setEmoji('✍️')
                ]);
            break;
            
        case 'professional':
            embed = new EmbedBuilder()
                .setTitle('💼 Professional Roles')
                .setDescription('Select professional roles:')
                .setColor(0x0099FF);
            
            selectMenu = new StringSelectMenuBuilder()
                .setCustomId('professional_roles')
                .setPlaceholder('Choose professional roles...')
                .setMinValues(1)
                .setMaxValues(3)
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Software Engineer')
                        .setDescription('Software development')
                        .setValue('software_engineer')
                        .setEmoji('💻'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Designer')
                        .setDescription('UI/UX and graphic design')
                        .setValue('designer')
                        .setEmoji('🎨'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Business')
                        .setDescription('Business and management')
                        .setValue('business')
                        .setEmoji('📊')
                ]);
            break;
    }
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.update({ embeds: [embed], components: [row] });
}

// Handle subcategory roles
async function handleSubcategoryRoles(interaction) {
    const selectedRoles = interaction.values;
    const member = interaction.member;
    const results = [];
    
    for (const roleValue of selectedRoles) {
        const roleName = roleValue.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        
        if (!role) {
            role = await interaction.guild.roles.create({
                name: roleName,
                color: 0x99AAB5,
                reason: 'Category role selection'
            });
        }
        
        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role);
            results.push(`➕ Added **${roleName}**`);
        } else {
            results.push(`✅ Already have **${roleName}**`);
        }
    }
    
    await interaction.reply({ content: results.join('\n'), ephemeral: true });
}

// Handle color selection
async function handleColorSelection(interaction) {
    const selectedColor = interaction.values[0];
    const member = interaction.member;
    
    // Remove existing color roles
    const colorRoles = ['Red', 'Blue', 'Green', 'Purple', 'Orange', 'Yellow'];
    const existingColorRoles = member.roles.cache.filter(role => 
        colorRoles.includes(role.name)
    );
    
    if (existingColorRoles.size > 0) {
        await member.roles.remove(existingColorRoles);
    }
    
    // Add new color role
    const roleName = selectedColor.charAt(0).toUpperCase() + selectedColor.slice(1);
    let role = interaction.guild.roles.cache.find(r => r.name === roleName);
    
    if (!role) {
        const colors = {
            red: 0xFF0000,
            blue: 0x0000FF,
            green: 0x00FF00,
            purple: 0x800080,
            orange: 0xFFA500,
            yellow: 0xFFFF00
        };
        
        role = await interaction.guild.roles.create({
            name: roleName,
            color: colors[selectedColor],
            reason: 'Color role selection'
        });
    }
    
    await member.roles.add(role);
    await interaction.reply({ content: `🌈 Your color has been set to **${roleName}**!`, ephemeral: true });
}

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.TOKEN);
