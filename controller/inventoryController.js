// controllers/inventoryController.js
const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

const getPerformedBy = async (req) => {
  if (req.user?._id) return req.user._id;
  const User = mongoose.model('User');
  const admin = await User.findOne({ role: { $in: ['Super Admin', 'Inventory Manager', 'Staff'] } }).lean();
  return admin?._id || new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
};

// Auto generate reference ID if not provided
const generateReferenceId = () => `ADJ-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

// Core stock adjustment (shared between add & update)
const adjustStock = async (req, res, variantIdFromParam = null) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      variantId: bodyVariantId,
      quantityChange,
      isStockIncreasing,
      movementType = "Manual Adjustment",
      reason,
      referenceId,
      expiryAlertDate,
      createdAt,
    } = req.body;

    const variantId = variantIdFromParam || bodyVariantId;

    if (!variantId || !mongoose.Types.ObjectId.isValid(variantId)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, msg: "Valid variantId required" });
    }

    const qty = Math.abs(Number(quantityChange));
    if (isNaN(qty) || qty === 0 || isStockIncreasing == null || !reason?.trim()) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, msg: "Invalid input data" });
    }

    const changeAmount = isStockIncreasing ? qty : -qty;

    // ATOMIC UPDATE + GET BOTH OLD AND NEW VALUES
    const updateResult = await Variant.findByIdAndUpdate(
      variantId,
      [
        {
          $set: {
            stockQuantity: {
              $cond: [
                { $lt: [{ $add: ["$stockQuantity", changeAmount] }, 0] },
                "$stockQuantity", // reject negative
                { $add: ["$stockQuantity", changeAmount] }
              ]
            },
            expiryDate: expiryAlertDate ? new Date(expiryAlertDate) : "$expiryDate"
          }
        }
      ],
      {
        new: true,           // return updated document
        runValidators: true,
        session,
        // This returns the document BEFORE modification when used with aggregation pipeline
        returnDocument: "before"
      }
    ).lean();

    if (!updateResult) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, msg: "Variant not found" });
    }

    const previousQty = updateResult.stockQuantity;
    const newQty = previousQty + changeAmount;

    // Double-check negative stock (in case race condition slipped through)
    if (newQty < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, msg: "Insufficient stock for deduction" });
    }

    // If we got here, the update succeeded and stock is valid
    // Now save the movement with CORRECT previous/new
    const movement = await StockMovement.create([{
      variant: variantId,
      sku: updateResult.sku,
      previousQuantity: previousQty,
      newQuantity: newQty,
      changeQuantity: changeAmount,
      isStockIncreasing: isStockIncreasing === true,
      movementType: movementType.trim(),
      reason: reason.trim(),
      referenceId: referenceId?.trim() || generateReferenceId(),
      performedBy: await getPerformedBy(req),
      createdAt
    }], { session });

    await session.commitTransaction();

    // Populate product name for response
    const variant = await Variant.findById(variantId)
      .populate('product', 'name')
      .session(session)
      .lean();

    res.json({
      success: true,
      msg: isStockIncreasing ? "Stock increased" : "Stock decreased",
      data: {
        variantId,
        productName: variant.product?.name || "Unknown",
        sku: updateResult.sku,
        previousQuantity: previousQty,
        newQuantity: newQty,
        change: changeAmount,
        movementType: movementType.trim(),
        referenceId: movement[0].referenceId,
        isStockIncreasing: isStockIncreasing === true,
        performedBy: req.user?.name || "System",
        performedAt: createdAt || new Date(),
        reason: reason.trim()
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Stock Adjustment FAILED:", err);
    res.status(500).json({ success: false, msg: "Server error", error: err.message });
  } finally {
    session.endSession();
  }
};

// ======================
// EXPORTS
// ======================

exports.addInventory    = (req, res) => adjustStock(req, res);
exports.updateInventory = (req, res) => adjustStock(req, res, req.params.variantId);




// FIXED: Stock Movements Dashboard – NEWEST FIRST + Low Stock Status
exports.getInventoryDashboard = async (req, res) => {
  try {
    const { 
      search = "", 
      page = 1, 
      limit = 50,
      movementType = "",
      startDate = "",
      endDate = ""
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    // Text search across related fields
    if (search) {
      filter.$or = [
        { "variantDoc.sku": { $regex: search, $options: "i" } },
        { "product.name": { $regex: search, $options: "i" } },
        { reason: { $regex: search, $options: "i" } },
        { movementType: { $regex: search, $options: "i" } }
      ];
    }

    if (movementType) filter.movementType = movementType;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const movements = await StockMovement.aggregate([
      { $match: filter },

      // FIX 1: Sort by REAL field → createdAt (not performedAt!)
      { $sort: { createdAt: -1 } },

      { $lookup: { from: "variants", localField: "variant", foreignField: "_id", as: "variantDoc" } },
      { $unwind: { path: "$variantDoc", preserveNullAndEmptyArrays: true } },

      { $lookup: { from: "products", localField: "variantDoc.product", foreignField: "_id", as: "product" } },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },

      { $lookup: { from: "brands", localField: "product.brand", foreignField: "_id", as: "brand" } },
      { $unwind: { path: "$brand", preserveNullAndEmptyArrays: true } },

      { $lookup: { from: "categories", localField: "product.category", foreignField: "_id", as: "category" } },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },

      { $lookup: { from: "users", localField: "performedBy", foreignField: "_id", as: "user" } },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          variantId: "$variantDoc._id",
          sku: "$variantDoc.sku",
          productName: "$product.name",
          brandName: "$brand.brandName",
          categoryName: "$category.name",
          thumbnail: { $ifNull: ["$variantDoc.image", "$product.thumbnail", "/placeholder.jpg"] },
          performedByName: { $ifNull: ["$user.name", "System"] },

          // Current live stock
          currentStock: "$variantDoc.stockQuantity",

          // Low stock threshold (supports both common field names)
          lowStockThreshold: {
            $ifNull: ["$variantDoc.lowStockThreshold", "$variantDoc.reorderLevel", 10]
          },

          // Compute stock status
          stockStatus: {
            $cond: [
              { $lte: ["$variantDoc.stockQuantity", 0] },
              "Out of Stock",
              {
                $cond: [
                  { $lte: ["$variantDoc.stockQuantity", { $ifNull: ["$variantDoc.lowStockThreshold", "$variantDoc.reorderLevel", 10] }] },
                  "Low Stock",
                  "Good"
                ]
              }
            ]
          },

          changeDisplay: {
            $cond: [
              "$isStockIncreasing",
              { $concat: ["+", { $toString: "$changeQuantity" }] },
              { $concat: ["−", { $toString: { $abs: "$changeQuantity" }}] }
            ]
          }
        }
      },

      { $skip: skip },
      { $limit: limitNum },

      {
        $project: {
          _id: 1,
          variantId: 1,
          sku: 1,
          productName: 1,
          brandName: 1,
          categoryName: 1,
          thumbnail: 1,
          currentStock: 1,
          lowStockThreshold: 1,
          stockStatus: 1,
          previousQuantity: 1,
          newQuantity: 1,
          changeQuantity: 1,
          changeDisplay: 1,
          isStockIncreasing: 1,
          movementType: 1,
          reason: 1,
          referenceId: 1,
          performedByName: 1,
          performedAt: "$createdAt",
          createdAt: 1
        }
      }
    ]);

    const total = await StockMovement.countDocuments(filter);

    res.json({
      success: true,
      msg: "Stock movements fetched successfully",
      data: movements,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum
      }
    });

  } catch (err) {
    console.error("Stock Movements Dashboard Error:", err);
    res.status(500).json({ 
      success: false, 
      msg: "Failed to load stock movements", 
      error: err.message 
    });
  }
};

// // Get single variant → returns basic info + LATEST STOCK MOVEMENT
// exports.getSingleVariant = async (req, res) => {
//   try {
//     let id = req.params.variantId || req.params.id;

//     if (!id || !mongoose.Types.ObjectId.isValid(id.toString().trim())) {
//       return res.status(400).json({ 
//         success: false, 
//         msg: "Valid variantId is required" 
//       });
//     }

//     id = id.toString().trim();

//   const variant = await Variant.findById(id)
//   .select('sku stockQuantity image product')
//   .populate({
//     path: 'product',
//     select: 'name thumbnail brand category',
//     populate: [
//       { path: 'brand', select: 'brandName' },
//       { path: 'category', select: 'name' }
//     ]
//   })
//   .lean();


//     if (!variant) {
//       return res.status(404).json({ success: false, msg: "Variant not found" });
//     }

//     // 2. Get the LATEST stock movement
//     const latestMovement = await StockMovement.findOne({ variant: id })
//       .populate('performedBy', 'name')
//       .sort({ createdAt: -1 })
//       .lean();

//     res.json({
//       success: true,
//       msg: latestMovement ? "Latest stock movement fetched" : "Variant found (no movements yet)",
//       data: {
//         variantId: variant._id.toString(),
//         productName: variant.product?.name || "Unknown Product",
//         brandName: variant.product?.brand?.brandName || "Unknown Brand",
//         categoryName: variant.product?.category?.name || "Unknown Category",
//         sku: variant.sku || "N/A",
//         currentStock: variant.stockQuantity,
//         thumbnail: variant.image || variant.product?.thumbnail || "/placeholder.jpg",

//         // ONLY the movement — clean and clear
//         movement: latestMovement ? {
//           previousQuantity: latestMovement.previousQuantity,
//           newQuantity: latestMovement.newQuantity,
//           changeQuantity: latestMovement.changeQuantity,
//           isStockIncreasing: latestMovement.isStockIncreasing,
//           movementType: latestMovement.movementType,
//           reason: latestMovement.reason,
//           referenceId: latestMovement.referenceId || null,
//           performedBy: latestMovement.performedBy?.name || "System",
//           performedAt: latestMovement.createdAt,
//           createdAt: latestMovement.createdAt
//         } : null
//       }
//     });

//   } catch (err) {
//     console.error("getSingleVariant Error:", err);
//     res.status(500).json({ 
//       success: false, 
//       msg: "Server error", 
//       error: err.message 
//     });
//   }
// };

exports.getSingleVariant = async (req, res) => {
  try {
    let id = req.params.variantId || req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id.toString().trim())) {
      return res.status(400).json({ success: false, msg: "Valid variantId is required" });
    }
    id = id.toString().trim();

    const result = await StockMovement.aggregate([
      { $match: { variant: new mongoose.Types.ObjectId(id) } },
      { $sort: { createdAt: -1 } },
      { $limit: 1 },

      { $lookup: { from: "variants", localField: "variant", foreignField: "_id", as: "variantDoc" } },
      { $unwind: { path: "$variantDoc", preserveNullAndEmptyArrays: true } },

      { $lookup: { from: "products", localField: "variantDoc.product", foreignField: "_id", as: "product" } },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },

      { $lookup: { from: "brands", localField: "product.brand", foreignField: "_id", as: "brand" } },
      { $unwind: { path: "$brand", preserveNullAndEmptyArrays: true } },

      { $lookup: { from: "categories", localField: "product.category", foreignField: "_id", as: "category" } },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },

      { $lookup: { from: "users", localField: "performedBy", foreignField: "_id", as: "user" } },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          variantId: "$variantDoc._id",
          sku: "$variantDoc.sku",
          productName: "$product.name",
          brandName: "$brand.brandName",
          categoryName: "$category.name",
          thumbnail: { $ifNull: ["$variantDoc.image", "$product.thumbnail", "/placeholder.jpg"] },
          performedByName: { $ifNull: ["$user.name", "System"] },
          currentStock: "$variantDoc.stockQuantity",
          lowStockThreshold: { $ifNull: ["$variantDoc.lowStockThreshold", "$variantDoc.reorderLevel", 10] },
          stockStatus: {
            $cond: [
              { $lte: ["$variantDoc.stockQuantity", 0] },
              "Out of Stock",
              {
                $cond: [
                  { $lte: ["$variantDoc.stockQuantity", { $ifNull: ["$variantDoc.lowStockThreshold", "$variantDoc.reorderLevel", 10] }] },
                  "Low Stock",
                  "Good"
                ]
              }
            ]
          },
          changeDisplay: {
            $cond: [
              "$isStockIncreasing",
              { $concat: ["+", { $toString: "$changeQuantity" }] },
              { $concat: ["−", { $toString: { $abs: "$changeQuantity" }}] }
            ]
          }
        }
      },

      {
        $project: {
          _id: 1,
          variantId: 1,
          sku: 1,
          productName: 1,
          brandName: 1,
          categoryName: 1,
          thumbnail: 1,
          currentStock: 1,
          lowStockThreshold: 1,
          stockStatus: 1,
          previousQuantity: 1,
          newQuantity: 1,
          changeQuantity: 1,
          changeDisplay: 1,
          isStockIncreasing: 1,
          movementType: 1,
          reason: 1,
          referenceId: 1,
          performedByName: 1,
          performedAt: "$createdAt",
          createdAt: 1
        }
      }
    ]);

    if (!result || result.length === 0) {
      const variant = await Variant.findById(id)
        .select('sku stockQuantity image product lowStockThreshold reorderLevel')
        .populate({
          path: 'product',
          select: 'name thumbnail brand category',
          populate: [
            { path: 'brand', select: 'brandName' },
            { path: 'category', select: 'name' }
          ]
        })
        .lean();

      if (!variant) {
        return res.status(404).json({ success: false, msg: "Variant not found" });
      }

      const threshold = variant.lowStockThreshold || variant.reorderLevel || 10;
      const status = variant.stockQuantity <= 0 ? "Out of Stock" :
                     variant.stockQuantity <= threshold ? "Low Stock" : "Good";

      return res.json({
        success: true,
        msg: "Variant found, but no stock movements yet",
        data: {
          variantId: variant._id.toString(),
          productName: variant.product?.name || "Unknown Product",
          brandName: variant.product?.brand?.brandName || "Unknown",
          categoryName: variant.product?.category?.name || "Unknown",
          sku: variant.sku || "N/A",
          currentStock: variant.stockQuantity,
          lowStockThreshold: threshold,
          stockStatus: status,
          thumbnail: variant.image || variant.product?.thumbnail || "/placeholder.jpg",
          movement: null
        }
      });
    }

    const latest = result[0];

    res.json({
      success: true,
      msg: "Latest stock movement fetched",
      data: {
        variantId: latest.variantId.toString(),
        productName: latest.productName,
        brandName: latest.brandName,
        categoryName: latest.categoryName,
        sku: latest.sku,
        currentStock: latest.currentStock,
        lowStockThreshold: latest.lowStockThreshold,
        stockStatus: latest.stockStatus,
        thumbnail: latest.thumbnail,
        movement: {
          _id: latest._id,
          previousQuantity: latest.previousQuantity,
          newQuantity: latest.newQuantity,
          changeQuantity: latest.changeQuantity,
          changeDisplay: latest.changeDisplay,
          isStockIncreasing: latest.isStockIncreasing,
          movementType: latest.movementType,
          reason: latest.reason,
          referenceId: latest.referenceId || null,
          performedBy: latest.performedByName,
          performedAt: latest.performedAt,
          createdAt: latest.createdAt
        }
      }
    });

  } catch (err) {
    console.error("getSingleVariant Error:", err);
    res.status(500).json({ success: false, msg: "Server error", error: err.message });
  }
};

// Stock movement history
exports.getStockMovements = async (req, res) => {
  try {
    const { variantId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(variantId)) {
      return res.status(400).json({ success: false, msg: "Invalid variant ID" });
    }

    const movements = await StockMovement.find({ variant: variantId })
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await StockMovement.countDocuments({ variant: variantId });

    res.json({
      success: true,
      data: movements.map(m => ({
        id: m._id,
        sku: m.sku,
        previousQuantity: m.previousQuantity,
        newQuantity: m.newQuantity,
        change: m.changeQuantity,
        movementType: m.movementType,
        reason: m.reason,
        referenceId: m.referenceId,
        performedBy: m.performedBy?.name || "System",
        date: m.createdAt
      })),
      pagination: { total, page: +page, pages: Math.ceil(total / limit), limit: +limit }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Failed to load history" });
  }
};