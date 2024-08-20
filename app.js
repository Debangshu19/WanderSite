if(process.env.NODE_ENV != "production"){
    require("dotenv").config();
}

const express = require("express");
const app = express();
const mongoose = require("mongoose");
const Listing = require("./models/listing.js");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const wrapAsync = require("./utils/wrapAsync.js");
const Review = require("./models/review.js");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user.js");
const {isLoggedIn, isOwner, isAuthor} = require("./middleware.js");
const {saveRedirectUrl, validateListing, validateReview} = require("./middleware.js");
const multer  = require('multer')
const {storage} = require("./cloudConfig.js");
const upload = multer({ storage });
const ExpressError = require("./utils/ExpressError.js");


app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({extended: true}));
app.use(methodOverride("_method"));
app.engine("ejs", ejsMate);
app.use(express.static(path.join(__dirname,"/public")));

const dbUrl = process.env.ATLASDB_URL;

const store = MongoStore.create({
    mongoUrl: dbUrl,
    crypto: {
        secret: process.env.SECRET,
    },
    touchAfter: 24 * 60 * 60, //seconds
});

store.on("error", () => {
    console.log("ERROR in MONGO SESSION STORE", err);
})

//SESSION
const sessionOptions = {
    store,
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
    },
};

app.use(cors(
    {
        origin: ["https://wander-site-8pqsygroo-debangshu19s-projects.vercel.app/"],
        methods: ["POST", "GET"],
        credentials: true
    }
));

//HOME PAGE
//app.get("/", (req,res) => {
//    res.send("Hi, I am root");
//});

//USE OF SESSION & FLASH
app.use(session(sessionOptions));
app.use(flash());

//PASSPORT
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

//FLASH
app.use((req,res,next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.currUser = req.user;
    next();
})

app.listen(8080, () => {
    console.log("server is listening to port 8080");
});


main()
    .then(() => {
        console.log("connected to DB");
    })
    .catch((err) => {
        console.log(err);
    });

async function main() {
    await mongoose.connect(dbUrl);
}

//INDEX ROUTE
app.get("/listings", wrapAsync(async (req,res) => {
    const allListings = await Listing.find({});
    res.render("listings/index.ejs", {allListings});
}));

//NEW ROUTE
app.get("/listings/new", isLoggedIn, (req,res) => {
    res.render("listings/new.ejs");
})

//SHOW ROUTE
app.get("/listings/:id", wrapAsync(async(req,res) => {
    let {id} = req.params;
    const listing = await Listing.findById(id).populate({path: "reviews", populate: {path: "author"},}).populate("owner");
    if(!listing){
        req.flash("error", "Listing you requested does not exist!");
        res.redirect("/listings");
    }
    res.render("listings/show.ejs", {listing});
}));

//CREATE ROUTE
app.post("/listings", isLoggedIn, upload.single("listing[image]"), validateListing, wrapAsync(async (req,res,next) => {
    if(!req.body.listing){
        throw new ExpressError(400, "Send valid data for listing");
    }
    let url = req.file.path;
    let filename = req.file.filename;
    const newListing = new Listing(req.body.listing);
    newListing.owner = req.user._id;
    newListing.image = {url, filename};
    await newListing.save();
    req.flash("success", "New Listing Created!");
    res.redirect("/listings");
}));

//EDIT ROUTE
app.get("/listings/:id/edit", isLoggedIn, isOwner, wrapAsync(async (req,res) => {
    let {id} = req.params;
    const listing = await Listing.findById(id);
    if(!listing){
        req.flash("error", "Listing you requested does not exist!");
        res.redirect("/listings");
    }
    let originalImageUrl = listing.image.url;
    originalImageUrl = originalImageUrl.replace("/upload", "/upload/h_300,w_250")
    res.render("listings/edit.ejs", {listing, originalImageUrl});
}));

//UPDATE ROUTE
app.put("/listings/:id", isLoggedIn, isOwner, upload.single("listing[image]"), validateListing, wrapAsync(async (req,res) => {
    if(!req.body.listing){
        throw new ExpressError(400, "Send valid data for listing");
    }
    let {id} = req.params;
    let listing = await Listing.findByIdAndUpdate(id, {...req.body.listing});

    if(typeof req.file !== "undefined") {
        let url = req.file.path;
        let filename = req.file.filename;
        listing.image = {url, filename};
        await listing.save();
    }
    req.flash("success", "Listing Updated!");
    res.redirect("/listings");
}));

//DELETE ROUTE
app.delete("/listings/:id", isLoggedIn, isOwner, wrapAsync(async (req,res) => {
    let {id} = req.params;
    let deletedListing = await Listing.findByIdAndDelete(id);
    //console.log(deletedListing);
    req.flash("success", "Listing Deleted!");
    res.redirect("/listings");
}));

//REVIEWS
//POST REVIEW ROUTE
app.post("/listings/:id/reviews", isLoggedIn, validateReview, wrapAsync(async(req,res) => {
    let listing = await Listing.findById(req.params.id);
    let newReview = new Review(req.body.review);

    newReview.author = req.user._id;
    listing.reviews.push(newReview);

    await newReview.save();
    await listing.save();

    console.log("new review saved");
    req.flash("success", "New Review Created!");
    res.redirect(`/listings/${listing.id}`);
}));

//DELETE REVIEW ROUTE
app.delete("/listings/:id/reviews/:reviewId", isLoggedIn, isAuthor, wrapAsync(async (req,res) => {
    let {id, reviewId} = req.params; 

    await Listing.findByIdAndUpdate(id, {$pull: {reviews: reviewId}});
    await Review.findByIdAndDelete(reviewId);
    req.flash("success", "Review Deleted!");
    res.redirect(`/listings/${id}`);
}));

//USER SIGNUP
app.get("/signup", (req,res) => {
    res.render("users/signup.ejs");
});

app.post("/signup", wrapAsync(async (req,res,next) => {
    try{
        let {username, email, password} = req.body;
        const newUser = new User({email, username});
        const registeredUser = await User.register(newUser, password);
        console.log(registeredUser);
        req.login(registeredUser, (err) => {
            if(err) {
                return next(err);
            }
            req.flash("success", "Welcome to WanderSight");
            res.redirect("/listings");
        });
    } catch(e) {
        req.flash("error", e.message);
        res.redirect("/signup");
    }
}));

//USER LOGIN
app.get("/login", (req,res) => {
    res.render("users/login.ejs");
});

app.post("/login", saveRedirectUrl,
    passport.authenticate("local", {
        failureRedirect: "/login",
        failureFlash: true,
    }), 
    async(req,res) => {
        req.flash("success", "Welcome back to WanderSight!");
        let redirectUrl = res.locals.redirectUrl || "/listings";
        res.redirect(redirectUrl);
});


//USER LOGOUT
app.get("/logout", (req,res,next) => {
    req.logout((err) =>{
        if(err){
            return next(err);
        }
        req.flash("success", "you are logged out!");
        res.redirect("/listings");
    });
});



//ERROR HANDLING MIDDLEWARES
//PAGE NOT FOUND ERROR
app.all("*", (req,res,next) => {
    next(new ExpressError(404, "Page not found!"));
});

//TO SHOW WHAT IS THE ERROR
app.use((err,req,res,next) => {
    let {statusCode=500, message="Something went wrong"} = err;
    res.render("error.ejs", {message});
    //res.status(statusCode).send(message);
});

