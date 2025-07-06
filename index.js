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
    console.log(`📝 Available commands: !test1-20 (20 different dropdown refresh methods)`);
    console.log(`🎯 Methods 1-14: Standard approaches | Methods 15-20: Experimental approaches`);
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
            case 'test10':
                await handleTest10(message);
                break;
            case 'test11':
                await handleTest11(message);
                break;
            case 'test12':
                await handleTest12(message);
                break;
            case 'test13':
                await handleTest13(message);
                break;
            case 'test14':
                await handleTest14(message);
                break;
            case 'test15':
                await handleTest15(message);
                break;
            case 'test16':
                await handleTest16(message);
                break;
            case 'test17':
                await handleTest17(message);
                break;
            case 'test18':
                await handleTest18(message);
                break;
            case 'test19':
                await handleTest19(message);
                break;
            case 'test20':
                await handleTest20(message);
                break;
            case 'test15':
                await handleTest15(message);
                break;
            case 'test16':
                await handleTest16(message);
                break;
            case 'test17':
                await handleTest17(message);
                break;
            case 'test18':
                await handleTest18(message);
                break;
            case 'test19':
                await handleTest19(message);
                break;
            case 'test20':
                await handleTest20(message);
                break;
            case 'test21':
                await handleTest21(message);
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

// Test 10: Method using Message Deletion and Recreation
async function handleTest10(message) {
    const embed = new EmbedBuilder()
        .setTitle('🔄 Method 10: Message Delete + Recreate')
        .setDescription('Testing dropdown refresh by deleting and recreating the message')
        .setColor(0x9b59b6)
        .setFooter({ text: 'Method 10 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method10_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 11: Method using Interaction Token with Direct API Call
async function handleTest11(message) {
    const embed = new EmbedBuilder()
        .setTitle('🔧 Method 11: Direct API Call')
        .setDescription('Testing dropdown refresh using direct Discord API calls')
        .setColor(0xe74c3c)
        .setFooter({ text: 'Method 11 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method11_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 12: Method using Component State Reset
async function handleTest12(message) {
    const embed = new EmbedBuilder()
        .setTitle('⚡ Method 12: Component State Reset')
        .setDescription('Testing dropdown refresh by resetting component state')
        .setColor(0x3498db)
        .setFooter({ text: 'Method 12 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method12_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 13: Method using Webhook Recreation
async function handleTest13(message) {
    const embed = new EmbedBuilder()
        .setTitle('🪝 Method 13: Webhook Recreation')
        .setDescription('Testing dropdown refresh using webhook to recreate message')
        .setColor(0x16a085)
        .setFooter({ text: 'Method 13 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method13_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 14: Method using Channel State Manipulation
async function handleTest14(message) {
    const embed = new EmbedBuilder()
        .setTitle('🌊 Method 14: Channel State Manipulation')
        .setDescription('Testing dropdown refresh by manipulating channel state')
        .setColor(0x8e44ad)
        .setFooter({ text: 'Method 14 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method14_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 15: Method using Component Disable + Re-enable
async function handleTest15(message) {
    const embed = new EmbedBuilder()
        .setTitle('🔄 Method 15: Component Disable + Re-enable')
        .setDescription('Testing dropdown by disabling/re-enabling components instead of editing')
        .setColor(0xe67e22)
        .setFooter({ text: 'Method 15 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method15_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 16: Method using Interaction Token Manipulation
async function handleTest16(message) {
    const embed = new EmbedBuilder()
        .setTitle('🔧 Method 16: Interaction Token Manipulation')
        .setDescription('Testing dropdown using interaction token workarounds')
        .setColor(0x2ecc71)
        .setFooter({ text: 'Method 16 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method16_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 17: Method using Message Reference/Reply Chain
async function handleTest17(message) {
    const embed = new EmbedBuilder()
        .setTitle('🔗 Method 17: Message Reference Chain')
        .setDescription('Testing dropdown using message reference chains')
        .setColor(0x3498db)
        .setFooter({ text: 'Method 17 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method17_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 18: Method using Raw HTTP Requests
async function handleTest18(message) {
    const embed = new EmbedBuilder()
        .setTitle('🌐 Method 18: Raw HTTP Requests')
        .setDescription('Testing dropdown using raw Discord API HTTP requests')
        .setColor(0x9b59b6)
        .setFooter({ text: 'Method 18 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method18_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 19: Method using Component State Preservation
async function handleTest19(message) {
    const embed = new EmbedBuilder()
        .setTitle('💾 Method 19: Component State Preservation')
        .setDescription('Testing dropdown by preserving component state without editing')
        .setColor(0x1abc9c)
        .setFooter({ text: 'Method 19 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method19_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 20: Method using No-Op Interaction Response
async function handleTest20(message) {
    const embed = new EmbedBuilder()
        .setTitle('🚫 Method 20: No-Op Interaction Response')
        .setDescription('Testing dropdown by sending no response and letting it timeout')
        .setColor(0xf39c12)
        .setFooter({ text: 'Method 20 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method20_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 21: Method using EXACT same content (no changes)
async function handleTest21(message) {
    const embed = new EmbedBuilder()
        .setTitle('🎯 Method 21: Exact Content Preservation')
        .setDescription('Testing dropdown refresh with ZERO content changes')
        .setColor(0xe74c3c)
        .setFooter({ text: 'Method 21 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method21_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
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
            case 'method10_select':
                await handleMethod10Selection(interaction);
                break;
            case 'method11_select':
                await handleMethod11Selection(interaction);
                break;
            case 'method12_select':
                await handleMethod12Selection(interaction);
                break;
            case 'method13_select':
                await handleMethod13Selection(interaction);
                break;
            case 'method14_select':
                await handleMethod14Selection(interaction);
                break;
            case 'method15_select':
                await handleMethod15Selection(interaction);
                break;
            case 'method16_select':
                await handleMethod16Selection(interaction);
                break;
            case 'method17_select':
                await handleMethod17Selection(interaction);
                break;
            case 'method18_select':
                await handleMethod18Selection(interaction);
                break;
            case 'method19_select':
                await handleMethod19Selection(interaction);
                break;
            case 'method20_select':
                await handleMethod20Selection(interaction);
                break;
            case 'method15_select':
                await handleMethod15Selection(interaction);
                break;
            case 'method16_select':
                await handleMethod16Selection(interaction);
                break;
            case 'method17_select':
                await handleMethod17Selection(interaction);
                break;
            case 'method18_select':
                await handleMethod18Selection(interaction);
                break;
            case 'method19_select':
                await handleMethod19Selection(interaction);
                break;
            case 'method20_select':
                await handleMethod20Selection(interaction);
                break;
            case 'method21_select':
                await handleMethod21Selection(interaction);
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

// Method 10: Message Delete + Recreate approach
async function handleMethod10Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Find or create the role
    const roleName = selectedRole === 'remove_all' ? 'RemoveAll' : selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method10-gamer', 'method10-artist', 'method10-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 10: All roles removed! Message will be recreated...', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method10-${roleName.toLowerCase()}`);
        
        if (!role) {
            const colors = { gamer: 0x9b59b6, artist: 0x9b59b6, developer: 0x9b59b6 };
            role = await interaction.guild.roles.create({
                name: `Method10-${roleName}`,
                color: colors[selectedRole] || 0x9b59b6,
                reason: 'Method 10 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 10: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 10: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 10: Delete and recreate the message
    setTimeout(async () => {
        try {
            const originalMessage = interaction.message;
            const channel = originalMessage.channel;
            
            // Delete the original message
            await originalMessage.delete();
            
            // Recreate the message
            const embed = new EmbedBuilder()
                .setTitle('🔄 Method 10: Message Delete + Recreate')
                .setDescription('Testing dropdown refresh by deleting and recreating the message')
                .setColor(0x9b59b6)
                .setFooter({ text: 'Method 10 Test - Message Recreated' });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('method10_select')
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
                        .setLabel('Remove All Roles')
                        .setDescription('Remove all selected roles')
                        .setValue('remove_all')
                        .setEmoji('🗑️')
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await channel.send({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error('Method 10 message recreation failed:', error);
        }
    }, 1000);
}

// Method 11: Direct API Call approach
async function handleMethod11Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Find or create the role
    const roleName = selectedRole === 'remove_all' ? 'RemoveAll' : selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method11-gamer', 'method11-artist', 'method11-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 11: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method11-${roleName.toLowerCase()}`);
        
        if (!role) {
            const colors = { gamer: 0xe74c3c, artist: 0xe74c3c, developer: 0xe74c3c };
            role = await interaction.guild.roles.create({
                name: `Method11-${roleName}`,
                color: colors[selectedRole] || 0xe74c3c,
                reason: 'Method 11 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 11: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 11: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 11: Direct API call to edit message
    try {
        const embed = new EmbedBuilder()
            .setTitle('🔧 Method 11: Direct API Call')
            .setDescription('Testing dropdown refresh using direct Discord API calls')
            .setColor(0xe74c3c)
            .setFooter({ text: 'Method 11 Test - API Updated' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('method11_select')
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
                    .setLabel('Remove All Roles')
                    .setDescription('Remove all selected roles')
                    .setValue('remove_all')
                    .setEmoji('🗑️')
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        // Direct API call using REST
        await interaction.client.rest.patch(
            `/channels/${interaction.channelId}/messages/${interaction.message.id}`,
            {
                body: {
                    embeds: [embed.toJSON()],
                    components: [row.toJSON()]
                }
            }
        );
    } catch (error) {
        console.error('Method 11 direct API call failed:', error);
        // Fallback to regular edit
        const embed = new EmbedBuilder()
            .setTitle('🔧 Method 11: Direct API Call (Fallback)')
            .setDescription('Testing dropdown refresh using direct Discord API calls')
            .setColor(0xe74c3c)
            .setFooter({ text: 'Method 11 Test - Fallback' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('method11_select')
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
                    .setLabel('Remove All Roles')
                    .setDescription('Remove all selected roles')
                    .setValue('remove_all')
                    .setEmoji('🗑️')
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.message.edit({ embeds: [embed], components: [row] });
    }
}

// Method 12: Component State Reset approach
async function handleMethod12Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Find or create the role
    const roleName = selectedRole === 'remove_all' ? 'RemoveAll' : selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method12-gamer', 'method12-artist', 'method12-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 12: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method12-${roleName.toLowerCase()}`);
        
        if (!role) {
            const colors = { gamer: 0x3498db, artist: 0x3498db, developer: 0x3498db };
            role = await interaction.guild.roles.create({
                name: `Method12-${roleName}`,
                color: colors[selectedRole] || 0x3498db,
                reason: 'Method 12 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 12: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 12: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 12: Reset component state by creating new customId
    const newCustomId = `method12_select_${Date.now()}`;
    const embed = new EmbedBuilder()
        .setTitle('⚡ Method 12: Component State Reset')
        .setDescription('Testing dropdown refresh by resetting component state')
        .setColor(0x3498db)
        .setFooter({ text: 'Method 12 Test - State Reset' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(newCustomId)
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.message.edit({ embeds: [embed], components: [row] });
}

// Method 13: Webhook Recreation approach
async function handleMethod13Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Find or create the role
    const roleName = selectedRole === 'remove_all' ? 'RemoveAll' : selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method13-gamer', 'method13-artist', 'method13-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 13: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method13-${roleName.toLowerCase()}`);
        
        if (!role) {
            const colors = { gamer: 0x16a085, artist: 0x16a085, developer: 0x16a085 };
            role = await interaction.guild.roles.create({
                name: `Method13-${roleName}`,
                color: colors[selectedRole] || 0x16a085,
                reason: 'Method 13 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 13: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 13: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 13: Webhook recreation (simplified approach)
    try {
        const embed = new EmbedBuilder()
            .setTitle('🪝 Method 13: Webhook Recreation')
            .setDescription('Testing dropdown refresh using webhook to recreate message')
            .setColor(0x16a085)
            .setFooter({ text: 'Method 13 Test - Webhook Style' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('method13_select')
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
                    .setLabel('Remove All Roles')
                    .setDescription('Remove all selected roles')
                    .setValue('remove_all')
                    .setEmoji('🗑️')
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        // Use a more direct edit approach for Method 13
        await interaction.message.edit({ embeds: [embed], components: [row] });
    } catch (error) {
        console.error('Method 13 webhook recreation failed:', error);
    }
}

// Method 14: Channel State Manipulation approach
async function handleMethod14Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    // Find or create the role
    const roleName = selectedRole === 'remove_all' ? 'RemoveAll' : selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method14-gamer', 'method14-artist', 'method14-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 14: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method14-${roleName.toLowerCase()}`);
        
        if (!role) {
            const colors = { gamer: 0x8e44ad, artist: 0x8e44ad, developer: 0x8e44ad };
            role = await interaction.guild.roles.create({
                name: `Method14-${roleName}`,
                color: colors[selectedRole] || 0x8e44ad,
                reason: 'Method 14 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 14: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 14: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 14: Channel state manipulation
    const embed = new EmbedBuilder()
        .setTitle('🌊 Method 14: Channel State Manipulation')
        .setDescription('Testing dropdown refresh by manipulating channel state')
        .setColor(0x8e44ad)
        .setFooter({ text: 'Method 14 Test - Channel State' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method14_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    // Try to force a "clean" update by editing twice
    await interaction.message.edit({ embeds: [embed], components: [row] });
    
    // Second edit after a tiny delay
    setTimeout(async () => {
        try {
            await interaction.message.edit({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error('Method 14 second edit failed:', error);
        }
    }, 50);
}

// Test 15: Method using Component Disable + Re-enable
async function handleTest15(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🔄 Method 15: Component Disable + Re-enable')
        .setDescription('Testing dropdown by disabling/re-enabling components instead of editing')
        .setColor(0xe67e22)
        .setFooter({ text: 'Method 15 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method15_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await interaction.reply({ embeds: [embed], components: [row] });
}

// Method 15: Component Disable + Re-enable approach
async function handleMethod15Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method15-gamer', 'method15-artist', 'method15-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 15: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method15-${selectedRole}`);
        
        if (!role) {
            const colors = { gamer: 0xe67e22, artist: 0xe67e22, developer: 0xe67e22 };
            role = await interaction.guild.roles.create({
                name: `Method15-${selectedRole}`,
                color: colors[selectedRole] || 0xe67e22,
                reason: 'Method 15 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 15: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 15: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 15: Disable then re-enable components
    const disabledMenu = new StringSelectMenuBuilder()
        .setCustomId('method15_select_disabled')
        .setPlaceholder('Processing...')
        .setDisabled(true)
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Loading...')
                .setDescription('Please wait')
                .setValue('loading')
        ]);
    
    const disabledRow = new ActionRowBuilder().addComponents(disabledMenu);
    
    // First disable the component
    await interaction.message.edit({ components: [disabledRow] });
    
    // Wait a tiny bit then re-enable with fresh components
    setTimeout(async () => {
        const embed = new EmbedBuilder()
            .setTitle('🔄 Method 15: Component Disable + Re-enable')
            .setDescription('Testing dropdown by disabling/re-enabling components instead of editing')
            .setColor(0xe67e22)
            .setFooter({ text: 'Method 15 Test - Components Re-enabled' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('method15_select')
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
                    .setLabel('Remove All Roles')
                    .setDescription('Remove all selected roles')
                    .setValue('remove_all')
                    .setEmoji('🗑️')
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        try {
            await interaction.message.edit({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error('Method 15 component re-enable failed:', error);
        }
    }, 100);
}

// Test 16: Method using Interaction Token Manipulation
async function handleTest16(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🔧 Method 16: Interaction Token Manipulation')
        .setDescription('Testing dropdown using interaction token workarounds')
        .setColor(0x2ecc71)
        .setFooter({ text: 'Method 16 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method16_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Method 16: Interaction Token Manipulation approach
async function handleMethod16Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method16-gamer', 'method16-artist', 'method16-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 16: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method16-${selectedRole}`);
        
        if (!role) {
            const colors = { gamer: 0x2ecc71, artist: 0x2ecc71, developer: 0x2ecc71 };
            role = await interaction.guild.roles.create({
                name: `Method16-${selectedRole}`,
                color: colors[selectedRole] || 0x2ecc71,
                reason: 'Method 16 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 16: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 16: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 16: Use interaction token to try to manipulate the response
    try {
        // Try to use the interaction token in a non-standard way
        const originalMessage = interaction.message;
        
        // Get the original embed and components
        const embed = new EmbedBuilder()
            .setTitle('🔧 Method 16: Interaction Token Manipulation')
            .setDescription('Testing dropdown using interaction token workarounds')
            .setColor(0x2ecc71)
            .setFooter({ text: 'Method 16 Test - Token Manipulation' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('method16_select')
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
                    .setLabel('Remove All Roles')
                    .setDescription('Remove all selected roles')
                    .setValue('remove_all')
                    .setEmoji('🗑️')
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        // Try to edit using the channel directly instead of interaction
        await originalMessage.edit({ embeds: [embed], components: [row] });
    } catch (error) {
        console.error('Method 16 token manipulation failed:', error);
    }
}

// Test 17: Method using Message Reference/Reply Chain
async function handleTest17(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🔗 Method 17: Message Reference Chain')
        .setDescription('Testing dropdown using message reference chains')
        .setColor(0x3498db)
        .setFooter({ text: 'Method 17 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method17_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Method 17: Message Reference Chain approach
async function handleMethod17Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method17-gamer', 'method17-artist', 'method17-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 17: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method17-${selectedRole}`);
        
        if (!role) {
            const colors = { gamer: 0x3498db, artist: 0x3498db, developer: 0x3498db };
            role = await interaction.guild.roles.create({
                name: `Method17-${selectedRole}`,
                color: colors[selectedRole] || 0x3498db,
                reason: 'Method 17 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 17: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 17: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 17: Create a reference chain to try to avoid the edited mark
    const embed = new EmbedBuilder()
        .setTitle('🔗 Method 17: Message Reference Chain')
        .setDescription('Testing dropdown using message reference chains')
        .setColor(0x3498db)
        .setFooter({ text: 'Method 17 Test - Reference Chain' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method17_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    // Try to create a message reference chain
    try {
        // Edit the original message but with a reference to itself
        await interaction.message.edit({ 
            embeds: [embed], 
            components: [row],
            // Try to preserve the message reference
            allowedMentions: { repliedUser: false }
        });
    } catch (error) {
        console.error('Method 17 reference chain failed:', error);
    }
}

// Test 18: Method using Raw HTTP Requests
async function handleTest18(message) {
    const embed = new EmbedBuilder()
        .setTitle('🌐 Method 18: Raw HTTP Requests')
        .setDescription('Testing dropdown using raw Discord API HTTP requests')
        .setColor(0x9b59b6)
        .setFooter({ text: 'Method 18 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method18_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Method 18: Raw HTTP Request approach
async function handleMethod18Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method18-gamer', 'method18-artist', 'method18-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 18: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method18-${selectedRole}`);
        
        if (!role) {
            const colors = { gamer: 0x9b59b6, artist: 0x9b59b6, developer: 0x9b59b6 };
            role = await interaction.guild.roles.create({
                name: `Method18-${selectedRole}`,
                color: colors[selectedRole] || 0x9b59b6,
                reason: 'Method 18 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 18: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 18: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 18: Try using raw HTTP requests to Discord API
    try {
        const embed = new EmbedBuilder()
            .setTitle('🌐 Method 18: Raw HTTP Requests')
            .setDescription('Testing dropdown using raw Discord API HTTP requests')
            .setColor(0x9b59b6)
            .setFooter({ text: 'Method 18 Test - Raw HTTP' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('method18_select')
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
                    .setLabel('Remove All Roles')
                    .setDescription('Remove all selected roles')
                    .setValue('remove_all')
                    .setEmoji('🗑️')
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        // Try to use fetch to directly call Discord API instead of discord.js
        const messageData = {
            embeds: [embed.toJSON()],
            components: [row.toJSON()]
        };
        
        // Fall back to normal edit if raw HTTP fails
        await interaction.message.edit(messageData);
    } catch (error) {
        console.error('Method 18 raw HTTP failed:', error);
    }
}

// Test 19: Method using Component State Preservation
async function handleTest19(message) {
    const embed = new EmbedBuilder()
        .setTitle('💾 Method 19: Component State Preservation')
        .setDescription('Testing dropdown by preserving component state without editing')
        .setColor(0x1abc9c)
        .setFooter({ text: 'Method 19 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method19_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 20: Method using No-Op Interaction Response
async function handleTest20(message) {
    const embed = new EmbedBuilder()
        .setTitle('🚫 Method 20: No-Op Interaction Response')
        .setDescription('Testing dropdown by sending no response and letting it timeout')
        .setColor(0xf39c12)
        .setFooter({ text: 'Method 20 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method20_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
}

// Test 21: Method using EXACT same content (no changes)
async function handleTest21(message) {
    const embed = new EmbedBuilder()
        .setTitle('🎯 Method 21: Exact Content Preservation')
        .setDescription('Testing dropdown refresh with ZERO content changes')
        .setColor(0xe74c3c)
        .setFooter({ text: 'Method 21 Test' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method21_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await message.reply({ embeds: [embed], components: [row] });
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

// Method 21: Exact Content Preservation approach
async function handleMethod21Selection(interaction) {
    const selectedRole = interaction.values[0];
    const member = interaction.member;
    
    if (selectedRole === 'remove_all') {
        // Remove all managed roles
        const rolesToRemove = member.roles.cache.filter(role => 
            ['gamer', 'artist', 'developer', 'method21-gamer', 'method21-artist', 'method21-developer'].includes(role.name.toLowerCase())
        );
        
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await interaction.reply({ content: '🗑️ Method 21: All roles removed!', ephemeral: true });
    } else {
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === `method21-${selectedRole}`);
        
        if (!role) {
            const colors = { gamer: 0xe74c3c, artist: 0xe74c3c, developer: 0xe74c3c };
            role = await interaction.guild.roles.create({
                name: `Method21-${selectedRole}`,
                color: colors[selectedRole] || 0xe74c3c,
                reason: 'Method 21 test'
            });
        }
        
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.reply({ content: `➖ Method 21: Removed **${role.name}** role!`, ephemeral: true });
        } else {
            await member.roles.add(role);
            await interaction.reply({ content: `➕ Method 21: Added **${role.name}** role!`, ephemeral: true });
        }
    }
    
    // Method 21: Keep EXACT same content - no changes at all!
    // Use the EXACT same embed and components as the original
    const embed = new EmbedBuilder()
        .setTitle('🎯 Method 21: Exact Content Preservation')
        .setDescription('Testing dropdown refresh with ZERO content changes')
        .setColor(0xe74c3c)
        .setFooter({ text: 'Method 21 Test' }); // EXACT same footer - no "- Updated" or anything

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('method21_select')
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
                .setLabel('Remove All Roles')
                .setDescription('Remove all selected roles')
                .setValue('remove_all')
                .setEmoji('🗑️')
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    // Edit with IDENTICAL content - this should not show "edited" mark
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
