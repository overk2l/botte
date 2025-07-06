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
    console.log(`📝 Available commands: !test1, !test2, !test3, !test4, !test5, !test6, !test7, !test8, !test9`);
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
            case 'test5':
                await handleTest5(message);
                break;
            case 'test6':
                await handleTest6(message);
                break;
            case 'test7':
                await handleTest7(message);
                break;
            case 'test8':
                await handleTest8(message);
                break;
            case 'test9':
                await handleTest9(message);
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

// Test 1: Method using interaction.reply + interaction.message.edit
async function handleTest1(message) {
    const embed = new EmbedBuilder()
        .setTitle('📝 Method 1: reply + message.edit')
        .setDescription('Testing dropdown refresh with interaction.reply + interaction.message.edit')
        .setColor(0x00AE86)
        .setFooter({ text: 'Method 1 Test' });

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

// Test 2: Method using interaction.reply + interaction.message.edit (Multi-select)
async function handleTest2(message) {
    const embed = new EmbedBuilder()
        .setTitle('🏷️ Method 2: Multi-select with reply + message.edit')
        .setDescription('Testing multi-select dropdown refresh with interaction.reply + interaction.message.edit')
        .setColor(0xFF6B6B)
        .setFooter({ text: 'Method 2 Test' });

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

// Test 3: Method using interaction.reply + interaction.message.edit (Direct Multi-select)
async function handleTest3(message) {
    const embed = new EmbedBuilder()
        .setTitle('🎯 Method 3: Direct multi-select with reply + message.edit')
        .setDescription('Testing direct multi-select dropdown refresh with interaction.reply + interaction.message.edit')
        .setColor(0x4ECDC4)
        .setFooter({ text: 'Method 3 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('direct_role_select')
        .setPlaceholder('Choose roles...')
        .setMinValues(1)
        .setMaxValues(9)
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
                .setEmoji('🏰'),
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
                .setEmoji('✍️'),
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
                .setEmoji('�')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 4: Method using interaction.reply + interaction.message.edit (Color roles)
async function handleTest4(message) {
    const embed = new EmbedBuilder()
        .setTitle('🌈 Method 4: Color roles with reply + message.edit')
        .setDescription('Testing color role dropdown refresh with interaction.reply + interaction.message.edit')
        .setColor(0x9B59B6)
        .setFooter({ text: 'Method 4 Test' });

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

// Test 5: Method using interaction.update()
async function handleTest5(message) {
    const embed = new EmbedBuilder()
        .setTitle('🔄 Method 5: interaction.update()')
        .setDescription('Testing dropdown refresh with interaction.update()')
        .setColor(0xFF5733)
        .setFooter({ text: 'Method 5 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method5_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role A')
                .setDescription('Method 5 test role A')
                .setValue('test_a')
                .setEmoji('🅰️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role B')
                .setDescription('Method 5 test role B')
                .setValue('test_b')
                .setEmoji('🅱️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role C')
                .setDescription('Method 5 test role C')
                .setValue('test_c')
                .setEmoji('🅾️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 6: Method using deferUpdate + editReply
async function handleTest6(message) {
    const embed = new EmbedBuilder()
        .setTitle('⏳ Method 6: deferUpdate + editReply')
        .setDescription('Testing dropdown refresh with deferUpdate + editReply')
        .setColor(0x33FF57)
        .setFooter({ text: 'Method 6 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method6_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role X')
                .setDescription('Method 6 test role X')
                .setValue('test_x')
                .setEmoji('❌'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Y')
                .setDescription('Method 6 test role Y')
                .setValue('test_y')
                .setEmoji('✅'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Z')
                .setDescription('Method 6 test role Z')
                .setValue('test_z')
                .setEmoji('⚡')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 7: Method using interaction.reply + message.edit (delayed)
async function handleTest7(message) {
    const embed = new EmbedBuilder()
        .setTitle('🕐 Method 7: reply + delayed edit')
        .setDescription('Testing dropdown refresh with reply + delayed message edit')
        .setColor(0x5733FF)
        .setFooter({ text: 'Method 7 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method7_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role 1')
                .setDescription('Method 7 test role 1')
                .setValue('test_1')
                .setEmoji('1️⃣'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role 2')
                .setDescription('Method 7 test role 2')
                .setValue('test_2')
                .setEmoji('2️⃣'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role 3')
                .setDescription('Method 7 test role 3')
                .setValue('test_3')
                .setEmoji('3️⃣')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 8: Method using only interaction.deferReply + interaction.editReply
async function handleTest8(message) {
    const embed = new EmbedBuilder()
        .setTitle('⚡ Method 8: deferReply + editReply')
        .setDescription('Testing dropdown refresh with deferReply + editReply only')
        .setColor(0x8B00FF)
        .setFooter({ text: 'Method 8 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method8_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Alpha')
                .setDescription('Method 8 test role Alpha')
                .setValue('test_alpha')
                .setEmoji('🔥'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Beta')
                .setDescription('Method 8 test role Beta')
                .setValue('test_beta')
                .setEmoji('⚡'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Gamma')
                .setDescription('Method 8 test role Gamma')
                .setValue('test_gamma')
                .setEmoji('✨')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 9: Method using interaction.deferUpdate only (no follow-up)
async function handleTest9(message) {
    const embed = new EmbedBuilder()
        .setTitle('🚀 Method 9: deferUpdate only')
        .setDescription('Testing dropdown refresh with deferUpdate only (silent)')
        .setColor(0xFF1493)
        .setFooter({ text: 'Method 9 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method9_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Silent Role A')
                .setDescription('Method 9 silent role A')
                .setValue('silent_a')
                .setEmoji('🤫'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Silent Role B')
                .setDescription('Method 9 silent role B')
                .setValue('silent_b')
                .setEmoji('🔇'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Silent Role C')
                .setDescription('Method 9 silent role C')
                .setValue('silent_c')
                .setEmoji('😶')
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
            case 'direct_role_select':
                await handleDirectRoleSelection(interaction);
                break;
            case 'color_select':
                await handleColorSelection(interaction);
                break;
            case 'method5_select':
                await handleMethod5Selection(interaction);
                break;
            case 'method6_select':
                await handleMethod6Selection(interaction);
                break;
            case 'method7_select':
                await handleMethod7Selection(interaction);
                break;
            case 'method8_select':
                await handleMethod8Selection(interaction);
                break;
            case 'method9_select':
                await handleMethod9Selection(interaction);
                break;
            case 'method8_select':
                await handleMethod8Selection(interaction);
                break;
            case 'method9_select':
                await handleMethod9Selection(interaction);
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
        
        // Reset the dropdown menu
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
        await interaction.message.edit({ embeds: [embed], components: [row] });
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
    
    // Reset the dropdown menu
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
    await interaction.message.edit({ embeds: [embed], components: [row] });
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
    
    // Reset the dropdown menu
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
    await interaction.message.edit({ embeds: [embed], components: [row] });
}

// Handle direct role selection (Test 3)
async function handleDirectRoleSelection(interaction) {
    const selectedRoles = interaction.values;
    const member = interaction.member;
    const results = [];
    
    for (const roleValue of selectedRoles) {
        const roleName = roleValue.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        
        if (!role) {
            const colors = {
                fps_player: 0xFF4444,
                rpg_player: 0x44FF44,
                strategy_player: 0x4444FF,
                digital_artist: 0xFF44FF,
                photographer: 0xFFFF44,
                writer: 0x44FFFF,
                software_engineer: 0xFF8844,
                designer: 0x8844FF,
                business: 0x44FF88
            };
            
            role = await interaction.guild.roles.create({
                name: roleName,
                color: colors[roleValue] || 0x99AAB5,
                reason: 'Direct role selection'
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
    
    // Reset the dropdown menu
    const embed = new EmbedBuilder()
        .setTitle('🎯 Professional Role Selection')
        .setDescription('Select professional roles directly!\n\n**Available Roles:**\n🔫 FPS Player - First-person shooter games\n⚔️ RPG Player - Role-playing games\n� Strategy Player - Strategy games\n🖼️ Digital Artist - Digital art and design\n📸 Photographer - Photography enthusiast\n✍️ Writer - Creative writing\n💻 Software Engineer - Software development\n🎨 Designer - UI/UX design\n📊 Business - Business and management')
        .setColor(0x4ECDC4)
        .setFooter({ text: 'Select any roles you want!' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('direct_role_select')
        .setPlaceholder('Choose roles...')
        .setMinValues(1)
        .setMaxValues(9)
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
                .setEmoji('🏰'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Digital Artist')
                .setDescription('Digital art and design')
                .setValue('digital_artist')
                .setEmoji('�️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Photographer')
                .setDescription('Photography enthusiast')
                .setValue('photographer')
                .setEmoji('�'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Writer')
                .setDescription('Creative writing')
                .setValue('writer')
                .setEmoji('✍️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Software Engineer')
                .setDescription('Software development')
                .setValue('software_engineer')
                .setEmoji('�'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Designer')
                .setDescription('UI/UX and graphic design')
                .setValue('designer')
                .setEmoji('🎨'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Business')
                .setDescription('Business and management')
                .setValue('business')
                .setEmoji('�')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.message.edit({ embeds: [embed], components: [row] });
}

// Method 5: Using interaction.update() approach
async function handleMethod5Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Find or create the role
    const roleName = selectedRole.replace('test_', 'Method5-').toUpperCase();
    let role = interaction.guild.roles.cache.find(r => r.name === roleName);
    
    if (!role) {
        role = await interaction.guild.roles.create({
            name: roleName,
            color: 0xFF5733,
            reason: 'Method 5 test'
        });
    }
    
    // Add/remove role
    if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
    } else {
        await member.roles.add(role);
    }
    
    // Method 5: Use interaction.update() to refresh dropdown
    const embed = new EmbedBuilder()
        .setTitle('🔄 Method 5: interaction.update()')
        .setDescription('Testing dropdown refresh with interaction.update()')
        .setColor(0xFF5733)
        .setFooter({ text: 'Method 5 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method5_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role A')
                .setDescription('Method 5 test role A')
                .setValue('test_a')
                .setEmoji('🅰️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role B')
                .setDescription('Method 5 test role B')
                .setValue('test_b')
                .setEmoji('🅱️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role C')
                .setDescription('Method 5 test role C')
                .setValue('test_c')
                .setEmoji('🅾️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    // Method 5: Only use interaction.update() 
    await interaction.update({ 
        embeds: [embed], 
        components: [row],
        content: `🔄 Method 5: Toggled **${roleName}** role!`
    });
}

// Method 6: Using deferUpdate + editReply approach
async function handleMethod6Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Defer the update first
    await interaction.deferUpdate();
    
    // Find or create the role
    const roleName = selectedRole.replace('test_', 'Method6-').toUpperCase();
    let role = interaction.guild.roles.cache.find(r => r.name === roleName);
    
    if (!role) {
        role = await interaction.guild.roles.create({
            name: roleName,
            color: 0x33FF57,
            reason: 'Method 6 test'
        });
    }
    
    // Add/remove role
    if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
    } else {
        await member.roles.add(role);
    }
    
    // Send ephemeral response
    await interaction.followUp({ content: `⏳ Method 6: Toggled **${roleName}** role!`, ephemeral: true });
    
    // Method 6: Use editReply to refresh dropdown
    const embed = new EmbedBuilder()
        .setTitle('⏳ Method 6: deferUpdate + editReply')
        .setDescription('Testing dropdown refresh with deferUpdate + editReply')
        .setColor(0x33FF57)
        .setFooter({ text: 'Method 6 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method6_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role X')
                .setDescription('Method 6 test role X')
                .setValue('test_x')
                .setEmoji('❌'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Y')
                .setDescription('Method 6 test role Y')
                .setValue('test_y')
                .setEmoji('✅'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Z')
                .setDescription('Method 6 test role Z')
                .setValue('test_z')
                .setEmoji('⚡')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.editReply({ embeds: [embed], components: [row] });
}

// Method 7: Using reply + delayed message edit
async function handleMethod7Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Find or create the role
    const roleName = selectedRole.replace('test_', 'Method7-');
    let role = interaction.guild.roles.cache.find(r => r.name === roleName);
    
    if (!role) {
        role = await interaction.guild.roles.create({
            name: roleName,
            color: 0x5733FF,
            reason: 'Method 7 test'
        });
    }
    
    // Add/remove role
    if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
    } else {
        await member.roles.add(role);
    }
    
    // Method 7: Send reply first, then edit the original message after a delay
    await interaction.reply({ content: `🕐 Method 7: Toggled **${roleName}** role!`, ephemeral: true });
    
    // Small delay before editing
    setTimeout(async () => {
        const embed = new EmbedBuilder()
            .setTitle('🕐 Method 7: reply + delayed edit')
            .setDescription('Testing dropdown refresh with reply + delayed message edit')
            .setColor(0x5733FF)
            .setFooter({ text: 'Method 7 Test' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('method7_select')
            .setPlaceholder('Choose a role...')
            .addOptions([
                new StringSelectMenuOptionBuilder()
                    .setLabel('Test Role 1')
                    .setDescription('Method 7 test role 1')
                    .setValue('test_1')
                    .setEmoji('1️⃣'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Test Role 2')
                    .setDescription('Method 7 test role 2')
                    .setValue('test_2')
                    .setEmoji('2️⃣'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Test Role 3')
                    .setDescription('Method 7 test role 3')
                    .setValue('test_3')
                    .setEmoji('3️⃣')
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        try {
            await interaction.message.edit({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error('Method 7 delayed edit failed:', error);
        }
    }, 100);
}

// Method 8: Using deferReply + editReply approach
async function handleMethod8Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Defer the reply first
    await interaction.deferReply({ ephemeral: true });
    
    // Find or create the role
    const roleName = selectedRole.replace('test_', 'Method8-');
    let role = interaction.guild.roles.cache.find(r => r.name === roleName);
    
    if (!role) {
        role = await interaction.guild.roles.create({
            name: roleName,
            color: 0x8B00FF,
            reason: 'Method 8 test'
        });
    }
    
    // Add/remove role
    if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
    } else {
        await member.roles.add(role);
    }
    
    // Send the ephemeral response
    await interaction.editReply({ content: `⚡ Method 8: Toggled **${roleName}** role!` });
    
    // Reset the dropdown menu without editing the original message
    const embed = new EmbedBuilder()
        .setTitle('⚡ Method 8: deferReply + editReply')
        .setDescription('Testing dropdown refresh with deferReply + editReply only')
        .setColor(0x8B00FF)
        .setFooter({ text: 'Method 8 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method8_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Alpha')
                .setDescription('Method 8 test role Alpha')
                .setValue('test_alpha')
                .setEmoji('🔥'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Beta')
                .setDescription('Method 8 test role Beta')
                .setValue('test_beta')
                .setEmoji('⚡'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Role Gamma')
                .setDescription('Method 8 test role Gamma')
                .setValue('test_gamma')
                .setEmoji('✨')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    // Try to edit the original message after a short delay
    setTimeout(async () => {
        try {
            await interaction.message.edit({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error('Method 8 message edit failed:', error);
        }
    }, 500);
}

// Method 9: Using deferUpdate only (silent approach)
async function handleMethod9Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Defer the update silently
    await interaction.deferUpdate();
    
    // Find or create the role
    const roleName = selectedRole.replace('silent_', 'Method9-');
    let role = interaction.guild.roles.cache.find(r => r.name === roleName);
    
    if (!role) {
        role = await interaction.guild.roles.create({
            name: roleName,
            color: 0xFF1493,
            reason: 'Method 9 test'
        });
    }
    
    // Add/remove role
    if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
    } else {
        await member.roles.add(role);
    }
    
    // Reset the dropdown menu using editReply
    const embed = new EmbedBuilder()
        .setTitle('🚀 Method 9: deferUpdate only')
        .setDescription('Testing dropdown refresh with deferUpdate only (silent)')
        .setColor(0xFF1493)
        .setFooter({ text: 'Method 9 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method9_select')
        .setPlaceholder('Choose a role...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Silent Role A')
                .setDescription('Method 9 silent role A')
                .setValue('silent_a')
                .setEmoji('🤫'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Silent Role B')
                .setDescription('Method 9 silent role B')
                .setValue('silent_b')
                .setEmoji('🔇'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Silent Role C')
                .setDescription('Method 9 silent role C')
                .setValue('silent_c')
                .setEmoji('😶')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.editReply({ embeds: [embed], components: [row] });
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
    
    // Reset the dropdown menu
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
    await interaction.message.edit({ embeds: [embed], components: [row] });
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
