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
    const { search = "", sort = "name", page = 1, limit = 100 } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build search filter
    const searchFilter = search
      ? {
          $or: [
            { "product.name": { $regex: search, $options: "i" } },
            { sku: { $regex: search, $options: "i" } },
            { "product.brand.name": { $regex: search, $options: "i" } },
            { "product.category.name": { $regex: search, $options: "i" } }, // added category in search
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

      // ===== PRODUCT LOOKUP =====
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },

      // ===== BRAND LOOKUP =====
      {
        $lookup: {
          from: "brands",
          localField: "product.brand",
          foreignField: "_id",
          as: "product.brand",
        },
      },
      { $unwind: { path: "$product.brand", preserveNullAndEmptyArrays: true } },

      // ===== CATEGORY LOOKUP (ADDED) =====
      {
        $lookup: {
          from: "categories",
          localField: "product.category",
          foreignField: "_id",
          as: "product.category",
        },
      },
      { $unwind: { path: "$product.category", preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          productName: "$product.name",
          brandName: "$product.brand.brandName",
          categoryName: "$product.category.name", // ADDED
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
      { $limit: limitNum },

      {
        $project: {
          _id: 1,
          productName: 1,
          brandName: 1,
          categoryName: 1, // ADDED IN OUTPUT
          thumbnail: 1,
          sku: 1,
          stockQuantity: 1,
          expiryDate: 1,
          statusLabel: 1,
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
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum * limitNum < total,
        hasPrev: pageNum > 1,
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



exports.updateInventory = async (req, res) => {
  try {
    const { variantId } = req.params;
    const {
      quantityChange,     // positive = add, negative = remove
      reason,
      expiryAlertDate
    } = req.body;

    // Validation
    if (quantityChange === undefined || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: "quantityChange and reason are required"
      });
    }

    const qty = Number(quantityChange);
    if (isNaN(qty) || qty === 0) {
      return res.status(400).json({ success: false, msg: "quantityChange must be a non-zero number" });
    }

    // Find variant
    const variant = await Variant.findById(variantId).populate('product', 'name');
    if (!variant) {
      return res.status(404).json({ success: false, msg: "Product variant not found" });
    }

    // Prevent negative stock
    if (variant.stockQuantity + qty < 0) {
      return res.status(400).json({
        success: false,
        msg: `Insufficient stock. Current: ${variant.stockQuantity}, Requested: ${qty}`
      });
    }

    const previousQty = variant.stockQuantity;

    // Update stock
    variant.stockQuantity += qty;

    // Update expiry if provided
    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (!isNaN(exp.getTime())) {
        variant.expiryDate = exp;
      }
    }

    await variant.save();

    // Get performedBy safely
    let performedBy = req.user?._id;
    if (!performedBy) {
      const User = mongoose.model('User');
      const admin = await User.findOne({ role: { $in: ['Admin', 'Inventory Manager'] } }).lean();
      performedBy = admin?._id || "507f1f77bcf86cd799439011";
    }

    // Create audit log
    await StockMovement.create({
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: qty,
      movementType: qty > 0 ? 'Purchase/Received' : 'Damage',
      reason: reason.trim(),
      performedBy
    });

    res.json({
      success: true,
      msg: qty > 0 ? "Stock added successfully" : "Stock removed successfully",
      data: {
        variantId: variant._id,
        productName: variant.product?.name || "Unknown",
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: qty,
        expiryDate: variant.expiryDate
      }
    });

  } catch (err) {
    console.error("Update Inventory Error:", err);
    res.status(500).json({
      success: false,
      msg: "Failed to update inventory",
      error: err.message
    });
  }
};




exports.getSingleInventory = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        msg: "Invalid inventory ID",
      });
    }

    // Find the variant + inventory
    const variant = await Variant.findById(id)
      .populate("product")
      .populate("unit");

    if (!variant) {
      return res.status(404).json({
        success: false,
        msg: "Inventory not found",
      });
    }

    // Find existing inventory entry for this variant
    const inventory = await Inventory.findOne({ variant: id });

    return res.status(200).json({
      success: true,
      data: {
        variant,
        inventory,
      },
    });
  } catch (error) {
    console.error("Error fetching single inventory:", error);
    return res.status(500).json({
      success: false,
      msg: "Server error",
    });
  }
};
