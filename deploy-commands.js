require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Open the guild dashboard")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Give overk2ll admin role")
    .toJSON()
];

const rest = new REST().setToken(process.env.TOKEN);

rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commands }
)
  .then(() => console.log("Commands deployed"))
  .catch(console.error);
