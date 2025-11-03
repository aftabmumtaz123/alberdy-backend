const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../model/User');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Rate limiters
const sendOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  message: { success: false, message: 'Too many OTP requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyOtpLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 5,
  message: { success: false, message: 'Too many OTP verification attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { success: false, message: 'Too many password reset attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Generate 6-digit OTP
const generateOTP = () => {
  const buffer = crypto.randomBytes(3);
  const num = buffer.readUIntBE(0, 3);
  return (num % 1000000).toString().padStart(6, '0');
};

// 1. Send OTP
router.post('/send-otp', sendOtpLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(200).json({ success: true, message: 'If the email exists, an OTP has been sent.' });
    }

    const otp = generateOTP();
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

    user.resetPasswordOTP = hashedOTP;
    user.resetPasswordExpire = Date.now() + 5 * 60 * 1000; // 5 minutes expiry
    user.isOtpVerified = false; // Reset OTP verification status
    await user.save();

    const savedUser = await User.findById(user._id).select('resetPasswordOTP resetPasswordExpire email isOtpVerified');
    console.log(
      `[DEBUG] Send-OTP POST-SAVE: Stored OTP hash="${savedUser.resetPasswordOTP}" | Expiry=${savedUser.resetPasswordExpire} | For email=${savedUser.email} | Generated OTP="${otp}" | isOtpVerified=${savedUser.isOtpVerified}`
    );

    const mailOptions = {
      to: user.email,
      from: process.env.EMAIL_USER,
      subject: 'Password Reset OTP',
      html: `
        <h2>Password Reset Request</h2>
        <p>Your verification OTP is: <strong style="font-size: 24px; color: #007bff;">${otp}</strong></p>
        <p>This OTP expires in 5 minutes. Use it to verify your email and reset your password.</p>
        <p><em>If you didn't request this, please ignore this email.</em></p>
        <hr>
        <small>This is an automated message. Do not reply.</small>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ success: true, message: 'OTP sent successfully to your email.' });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// 2. Verify OTP
router.post('/verify-otp', verifyOtpLimiter, async (req, res) => {
  try {
    let { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    otp = String(otp).trim();
    if (otp.length !== 6 || isNaN(otp)) {
      return res.status(400).json({ success: false, message: 'OTP must be a 6-digit number' });
    }

    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

    const user = await User.findOne({
      email,
      resetPasswordOTP: hashedOTP,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP, or email mismatch' });
    }

    user.isOtpVerified = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. Proceed to reset password.',
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// 3. Reset Password
router.put('/reset-password', resetPasswordLimiter, async (req, res) => {
  try {
    const { email, password, cPassword } = req.body;

    if (!email || !password || !cPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and confirm password are required',
      });
    }

    if (password !== cPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message:
          'Password must be at least 8 characters long, including uppercase, lowercase, number, and special character.',
      });
    }


    const user = await User.findOne({
      email,
      isOtpVerified: true,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'OTP not verified, expired, or email mismatch',
      });
    }

    
    user.password = password;
    user.resetPasswordOTP = undefined;
    user.resetPasswordExpire = undefined;
    user.isOtpVerified = false;
    await user.save();

    const payload = { user: { id: user._id } };
    const authToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5h' });

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You are now logged in.',
      token: authToken,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.',
    });
  }
});

module.exports = router;