const jwt = require("jsonwebtoken");
const { promisify } = require("util");
const RefreshToken = require("../model/refreshToken"); // Adjust path to match your models folder
const User = require("../model/User"); // Matches project User model
require("dotenv").config();
const verifyJwt = promisify(jwt.verify);

const authMiddleware = async (req, res, next) => {
  try {
    // Extract tokens (prefer header for API, fallback to cookie for browser)
    let accessToken =
      req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.split(" ")[1]
        : req.cookies.access_token;

    const refreshToken = req.cookies.refresh_token;

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: "No access token provided. Please log in.",
      });
    }

    let decoded;
    try {
      // Verify access token
      decoded = await verifyJwt(accessToken, process.env.JWT_SECRET);
      req.user = decoded; // { id, role } from project payload
      return next();
    } catch (err) {
      if (err.name !== "TokenExpiredError") {
        return res.status(403).json({ success: false, message: "Invalid access token." });
      }
    }

    // --- If access token expired, try refresh token ---
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }

    let decodedRefresh;
    try {
      decodedRefresh = await verifyJwt(refreshToken, process.env.REFRESH_SECRET);
    } catch {
      return res.status(403).json({ success: false, message: "Invalid refresh token. Please log in again." });
    }

    // Check refresh token in DB
    const storedToken = await RefreshToken.findOne({
      token: refreshToken,
      userId: decodedRefresh.id,
    });

    if (!storedToken || storedToken.expiresAt < Date.now()) {
      return res.status(403).json({ success: false, message: "Refresh token expired or revoked. Please log in again." });
    }

    // Ensure User still exists
    const user = await User.findById(decodedRefresh.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User no longer exists." });
    }

    // Issue new access token (match project payload: id, role)
    const newAccessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" } // Adjust expiry as needed (project used 1h, but short for access)
    );

    // Set new access token cookie (optional; project uses headers primarily)
    res.cookie("access_token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 120 * 60 * 1000, // 2 hours
    });

    req.user = { id: user._id, role: user.role };
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ success: false, message: "There was a problem with authentication." });
  }
};

module.exports = authMiddleware;