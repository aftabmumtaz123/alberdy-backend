// In your routes file, e.g., routes/auth.js or app.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs'); // Assuming you're using bcrypt for hashing
const crypto = require('crypto'); // For generating tokens
const nodemailer = require('nodemailer'); // Install if not already: npm i nodemailer
const User = require('../model/User'); // Adjust path to your User model
const jwt = require('jsonwebtoken'); // Add this import if not already present

// Email transporter setup (configure with your SMTP details, e.g., Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail', // Or your email service
  auth: {
    user: process.env.EMAIL_USER, // Set in .env
    pass: process.env.EMAIL_PASS, // Set in .env (app password for Gmail)
  },
});

// Rate limiting middleware (separate for forgot and reset to balance usability/security)
const rateLimit = require('express-rate-limit');

// Forgot password limiter: 3 attempts per 15min per IP (anti-spam, allows minor retries)
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  message: { message: 'Too many forgot-password requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reset password limiter: 5 attempts per 1hr per IP (allows a few OTP/password mistypes)
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { message: 'Too many reset attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Secure OTP generator using crypto (fixed: byteLength to 3 bytes for 24 bits)
const generateOTP = () => {
  const buffer = crypto.randomBytes(3);
  const num = buffer.readUIntBE(0, 3); // Read 3 bytes (24 bits)
  return (num % 1000000).toString().padStart(6, '0'); // Mod 1e6 for uniform 6-digit, pad with zeros
};

// POST /api/auth/forgot-password (OTP version with rate limiting + enhanced debug)
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Security: Don't reveal if email exists
      return res.status(200).json({ message: 'If the email exists, a reset code has been sent.' });
    }

    // Generate OTP
    const otp = generateOTP();
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

    // Set OTP and expiry (5 mins)
    user.resetPasswordOTP = hashedOTP;
    user.resetPasswordExpire = Date.now() + 5 * 60 * 1000;
    await user.save();

    // ENHANCED DEBUG LOG: Confirm stored after save (remove in prod!)
    const savedUser = await User.findById(user._id).select('resetPasswordOTP resetPasswordExpire email');
    console.log(`[DEBUG] Forgot-password POST-SAVE: Stored OTP hash="${savedUser.resetPasswordOTP}" | Expiry=${savedUser.resetPasswordExpire} | For email=${savedUser.email} | Generated OTP="${otp}"`);

    // Email options (OTP in plain text within HTML for readability; consider templating engine like Handlebars for prod)
    const mailOptions = {
      to: user.email,
      from: process.env.EMAIL_USER,
      subject: 'Password Reset Code',
      html: `
        <h2>Password Reset Request</h2>
        <p>Your verification code is: <strong style="font-size: 24px; color: #007bff;">${otp}</strong></p>
        <p>This code expires in 5 minutes. Enter it on the reset form along with your new password.</p>
        <p><em>If you didn't request this, please ignore this email.</em></p>
        <hr>
        <small>This is an automated message. Do not reply.</small>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ message: 'Reset code sent successfully.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
});

// PUT /api/auth/reset-password (OTP version with improved limiting + debug log)
router.put('/reset-password', resetLimiter, async (req, res) => {
  try {
    let { otp, password } = req.body;

    if (!otp || !password) {
      return res.status(400).json({ message: 'OTP and password are required' });
    }

    // Force OTP to string and trim any whitespace (handles copy-paste issues)
    otp = String(otp).trim();

    // Password strength validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ 
        message: 'Password must be at least 8 characters long, including uppercase, lowercase, number, and special character (@$!%*?&).' 
      });
    }

    // Hash the provided OTP
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

    // DEBUG LOG: Print provided OTP and computed hash (remove in prod!)
    console.log(`[DEBUG] Reset-password: Provided OTP="${otp}" | Computed hash="${hashedOTP}" | From IP=${req.ip}`);

    // TEMP DEBUG: Log stored values (include "email" in body for this; remove after fix!)
    let user;
    if (req.body.email) { // Only if email provided for debugging
      const debugUser = await User.findOne({ email: req.body.email }).select('resetPasswordOTP resetPasswordExpire email');
      if (debugUser) {
        console.log(`[DEBUG] Stored for email="${debugUser.email}": hash="${debugUser.resetPasswordOTP}" | Expiry=${debugUser.resetPasswordExpire} | Now=${Date.now()} | Expired?=${debugUser.resetPasswordExpire < Date.now()}`);
        console.log(`[DEBUG] Hash match? ${debugUser.resetPasswordOTP === hashedOTP}`);
      } else {
        console.log(`[DEBUG] No user found for email="${req.body.email}"`);
      }
    }

    // Find user by hashed OTP and expiry
    user = await User.findOne({
      resetPasswordOTP: hashedOTP,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      console.log(`[DEBUG] No matching user found for hash="${hashedOTP}"`);
      return res.status(400).json({ message: 'Invalid or expired code. Request a new one.' });
    }

    // DEBUG LOG: Match found!
    console.log(`[DEBUG] OTP match confirmed for user=${user.email}`);

    // Hash new password with higher salt rounds
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(password, salt);

    // Clear reset fields to prevent reuse
    user.resetPasswordOTP = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    // Generate JWT for auto-login (ensure JWT_SECRET is set in .env)
    const payload = { user: { id: user.id } };
    const authToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5h' });

    console.log(`Password reset successful for ${user.email} from IP: ${req.ip}`);

    res.status(200).json({ 
      message: 'Password reset successful. You are now logged in.', 
      token: authToken,
      user: { id: user._id, email: user.email } // Exclude sensitive fields like name if present
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
});

module.exports = router;