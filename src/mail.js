const nodemailer = require('nodemailer')
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true, // true for 465, false for 587
  auth: {
    user: "support@safenestpest.com",   // your Zoho email
    pass: "FV74mafF2igQ",
  },
});

async function sendMail() {
  const info = await transporter.sendMail({
    from: '"SafeNest Pest" <support@safenestpest.com>',
    to: "erprabhat1323@gmail.com",
    subject: "Welcome!",
    html: "<h1>🎉 Hello!</h1><p>Your Zoho Mail setup is working.</p>",
  });

  console.log("✅ Mail sent:", info.messageId);
}

sendMail().catch(console.error);

