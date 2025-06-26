import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import twilio from 'twilio';

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(accountSid, authToken);

// tu endpoint webhook y lógica van acá...

app.listen(3000, () => {
  console.log('Servidor escuchando en puerto 3000');
});
