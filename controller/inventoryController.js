// controllers/inventoryController.js  ← FINAL SERVERLESS VERSION
const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

exports.addInventory = async (req, res) => {
  try {
    const {
      variantId,
      quantityChange,
      reason,
      referenceId,
      expiryAlertDate
    } = req.body;

    if (!variantId || quantityChange === undefined || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: "Product, quantity change, and reason are required"
      });
    }

    const qty = Number(quantityChange);
    if (isNaN(qty) || qty === 0) {
      return res.status(400).json({ success: false, msg: "Invalid quantity" });
    }

    // === FIND VARIANT ===
    const variant = await Variant.findById(variantId).populate('product', 'name');
    if (!variant) {
      return res.status(404).json({ success: false, msg: "Variant not found" });
    }

    // === PREVENT NEGATIVE STOCK ===
    if (variant.stockQuantity + qty < 0) {
      return res.status(400).json({
        success: false,
        msg: `Insufficient stock: ${variant.stockQuantity}`
      });
    }

    const previousQty = variant.stockQuantity;

    // === UPDATE STOCK & EXPIRY ===
    variant.stockQuantity += qty;

    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (!isNaN(exp.getTime())) {
        variant.expiryDate = exp;
      }
    }

    await variant.save();

    // === GET USER ID (SAFE) ===
    let performedBy = req.user?._id;
    if (!performedBy) {
      const User = mongoose.model('User');
      const fallback = await User.findOne({ role: { $in: ['Admin', 'Inventory Manager'] } }).lean();
      performedBy = fallback?._id || "507f1f77bcf86cd799439011"; // final fallback
    }

    // === CREATE LOG (NO SESSION NEEDED) ===
    await StockMovement.create({
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: qty,
      movementType: qty > 0 ? 'Purchase/Received' : 'Damage',
      reason: reason.trim(),
      referenceId: referenceId?.trim() || null,
      performedBy
    });

    // === SUCCESS ===
    res.json({
      success: true,
      msg: qty > 0 ? "Stock added successfully" : "Stock removed successfully",
      data: {
        productName: variant.product?.name || "Unknown",
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: qty
      }
    });

  } catch (err) {
    console.error("Inventory Error:", err);
    res.status(500).json({
      success: false,
      msg: "Server error",
      error: err.message
    });
  }
};



exports.getInventoryDashboard = async (req, res) => {
  try {
    const { search = "", sort = "name", page = 1, limit=100 } = req.query;
    const skip = (page - 1) * limit;

    // Build search filter
    const searchFilter = search
      ? {
          $or: [
            { "product.name": { $regex: search, $options: "i" } },
            { sku: { $regex: search, $options: "i" } },
            { "product.brand.name": { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const variants = await Variant.aggregate([
      {
        $match: {
          isDeleted: { $ne: true },
          status: { $ne: "Discontinued" },
          ...searchFilter,
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: "brands",
          localField: "product.brand",
          foreignField: "_id",
          as: "product.brand",
        },
      },
      { $unwind: { path: "$product.brand", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          productName: "$product.name",
          brandName: "$product.brand.brandName",
          thumbnail: {
            $ifNull: ["$image", "$product.thumbnail", "/placeholder.jpg"],
          },
          lowStockWarning: {
            $cond: [{ $lte: ["$stockQuantity", 10] }, true, false],
          },
          statusLabel: {
            $cond: {
              if: { $and: ["$expiryDate", { $lt: ["$expiryDate", new Date()] }] },
              then: "Expired",
              else: {
                $cond: [
                  { $lte: ["$stockQuantity", 10] },
                  "Low Stock",
                  "Good",
                ],
              },
            },
          },
        },
      },
      {
        $sort: {
          ...(sort === "name" && { productName: 1 }),
          ...(sort === "stock" && { stockQuantity: 1 }),
          ...(sort === "expiry" && { expiryDate: 1 }),
          updatedAt: -1,
        },
      },
      { $skip: skip },
      { $limit: Number(limit) },
      {
        $project: {
          _id: 1,
          productName: 1,
          brandName: 1,
          thumbnail: 1,
          sku: 1,
          stockQuantity: 1,
          expiryDate: 1,
          statusLabel: 1,
          statusColor: 1,
          lowStockWarning: 1,
          updatedAt: 1,
        },
      },
    ]);

    const total = await Variant.countDocuments({
      isDeleted: { $ne: true },
      status: { $ne: "Discontinued" },
      ...searchFilter,
    });

    res.json({
      success: true,
      data: variants,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({
      success: false,
      msg: "Failed to load inventory",
      error: err.message,
    });
  }
};