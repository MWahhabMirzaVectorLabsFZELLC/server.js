require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const cors = require("cors");
const moment = require("moment");
require("moment-timezone");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: "*",
    methods: "GET, POST, PUT, DELETE",
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
}));
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send("Welcome to the Ethereum-RUNE LP Token Tracker API");
});

mongoose
	.connect(process.env.MONGODB_URI)
	.then(() => {
		console.log("Connected to MongoDB Atlas");
	})
	.catch((err) => {
		console.error("Error connecting to MongoDB Atlas", err);
	});

const providerSchema = new mongoose.Schema({
	providerAddress: { type: String, unique: true },
	amountWBTC: String,
	amountRUNE: String,
	lpTokenKey: { type: String, unique: true },
	timestamp: String,
});

const Provider = mongoose.model("Provider", providerSchema);

app.use(express.json());

app.post("/api/provider", async (req, res) => {
	const { providerAddress, amountWBTC, amountRUNE, lpTokenKey } = req.body;

	if (!providerAddress || !amountWBTC || !amountRUNE || !lpTokenKey) {
		return res.status(400).send({ message: "Missing required fields" });
	}

	try {
		const timestamp = moment().tz("Asia/Karachi").format();

		const existingProvider = await Provider.findOne({ providerAddress });

		if (existingProvider) {
			existingProvider.amountWBTC = amountWBTC;
			existingProvider.amountRUNE = amountRUNE;
			existingProvider.lpTokenKey = lpTokenKey;
			existingProvider.timestamp = timestamp;

			await existingProvider.save();
			return res.status(200).send(existingProvider);
		} else {
			const provider = new Provider({
				providerAddress,
				amountWBTC,
				amountRUNE,
				lpTokenKey,
				timestamp,
			});

			await provider.save();
			return res.status(201).send(provider);
		}
	} catch (error) {
		console.error("Error saving provider:", error);
		res.status(400).send({ message: "Failed to store provider info", error });
	}
});

app.get("/api/providers", async (req, res) => {
	try {
		const providers = await Provider.find();
		res.json(providers);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
});

// Define schema and model for poolInfos collection
const poolInfoSchema = new mongoose.Schema({
	RuneChart: {
		type: Number,
		required: true,
	},
	WbtcChart: {
		type: Number,
		required: true,
	},
	timestamp: {
		type: Date,
		default: Date.now,
	},
});

const PoolInfo = mongoose.model("PoolInfo", poolInfoSchema);

app.post("/api/poolinfo", async (req, res) => {
	try {
		const { RuneChart, WbtcChart } = req.body;

		const newPoolInfo = new PoolInfo({
			RuneChart,
			WbtcChart,
		});

		const savedPoolInfo = await newPoolInfo.save();

		res.status(201).json(savedPoolInfo);
	} catch (error) {
		console.error("Error inserting data into MongoDB:", error);
		res.status(500).json({ error: "Error inserting data into MongoDB" });
	}
});

app.get("/api/poolinfos", async (req, res) => {
	try {
		const poolInfos = await PoolInfo.find();
		res.json(poolInfos);
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
});

app.post("/api/poolinfo", async (req, res) => {
	try {
		const { RuneChart, WbtcChart } = req.body;

		const existingPoolInfo = await PoolInfo.findOne({ RuneChart, WbtcChart });

		if (existingPoolInfo) {
			return res.status(200).json(existingPoolInfo);
		}

		const newPoolInfo = new PoolInfo({
			RuneChart,
			WbtcChart,
		});

		const savedPoolInfo = await newPoolInfo.save();

		res.status(201).json(savedPoolInfo);
	} catch (error) {
		console.error("Error inserting data into MongoDB:", error);
		res.status(500).json({ error: "Error inserting data into MongoDB" });
	}
});

const swapDataSchema = new mongoose.Schema({
	direction: String,
	amount: Number,
	rate: Number,
	address: String,
	estimatedAmount: Number,
	transactionFee: Number,
	timestamp: { type: Date, default: Date.now },
});

const SwapData = mongoose.model("SwapData", swapDataSchema);

app.post("/api/storeSwapData", async (req, res) => {
	try {
		const {
			direction,
			amount,
			rate,
			address,
			estimatedAmount,
			transactionFee,
			timestamp,
		} = req.body;

		const swapData = new SwapData({
			direction,
			amount,
			rate,
			address,
			estimatedAmount,
			transactionFee,
			timestamp,
		});

		await swapData.save();
		await updatePoolInfo(direction, amount, estimatedAmount, transactionFee);

		res
			.status(201)
			.json({ message: "Swap data stored successfully", id: swapData._id });
	} catch (error) {
		console.error("Error storing swap data:", error);
		res.status(500).json({ error: "Error storing swap data" });
	}
});

app.get("/api/swapData", async (req, res) => {
	try {
		const swapData = await SwapData.find();
		res.json(swapData);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
});

async function updatePoolInfo(
	direction,
	amount,
	estimatedAmount,
	transactionFee
) {
	try {
		const latestPoolInfo = await PoolInfo.findOne().sort({ timestamp: -1 });

		if (!latestPoolInfo) {
			throw new Error("No pool information found.");
		}

		let updatedRuneChart = latestPoolInfo.RuneChart;
		let updatedWbtcChart = latestPoolInfo.WbtcChart;

		if (direction === "RUNE to WBTC") {
			updatedRuneChart += parseFloat(amount) - parseFloat(transactionFee);
			updatedWbtcChart -= parseFloat(estimatedAmount);
		} else if (direction === "WBTC to RUNE") {
			updatedRuneChart -= parseFloat(estimatedAmount);
			updatedWbtcChart += parseFloat(amount) - parseFloat(transactionFee);
		}

		const updatedPoolInfo = new PoolInfo({
			RuneChart: updatedRuneChart,
			WbtcChart: updatedWbtcChart,
			timestamp: new Date(),
		});

		await updatedPoolInfo.save();

		return updatedPoolInfo;
	} catch (error) {
		console.error("Error updating pool info:", error);
		throw new Error("Error updating pool info");
	}
}

app.post("/api/updatePoolInfo", async (req, res) => {
	try {
		const { runeAmount, wbtcAmount } = req.body;

		if (runeAmount === undefined || wbtcAmount === undefined) {
			return res.status(400).send({ message: "Missing required fields" });
		}

		const latestPoolInfo = await PoolInfo.findOne().sort({ timestamp: -1 });

		latestPoolInfo.RuneChart = runeAmount;
		latestPoolInfo.WbtcChart = wbtcAmount;
		latestPoolInfo.timestamp = new Date();

		await latestPoolInfo.save();

		res.status(200).json(latestPoolInfo);
	} catch (error) {
		console.error("Error updating pool info:", error);
		res.status(500).json({ error: "Error updating pool info" });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
