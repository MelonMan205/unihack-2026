Software Requirements Specification for Happs
1. Introduction
1.1 Purpose
Happs is a web application that aims to solve the problem of spontaneous boredom by helping users find events and activities happening nearby in Melbourne.  The primary goal is to allow a user to open the app at any time—morning or evening—and quickly discover something interesting to do within minutes.  The app aggregates event data from public sources (city event listings, university calendars, venue calendars) and presents it on an interactive map alongside a searchable feed.  This document specifies the requirements for building Happs so that it functions reliably across desktop and mobile web environments.
1.2 Intended Audience and Reading Suggestions
This Software Requirements Specification (SRS) is intended for:
Developers and designers who will design, implement and test the application.


Project managers who need to track feature scope and milestones.


Stakeholders such as university event organisers, student club representatives and potential investors who need to understand the app’s capabilities.


The document follows the IEEE SRS format and contains detailed functional and non‑functional requirements, design constraints and a description of the data sources used for scraping events.  Readers new to the project should begin with sections 1–2 to understand the purpose and scope, then consult section 3 for specific requirements.
1.3 Scope
Happs is a cross‑platform web app accessible via desktop browsers and mobile browsers.  The scope includes:
A responsive map view that displays “happs” (events) as pins on a map of Melbourne.


A feed view that lists events chronologically or based on user preferences.


Search and filtering features to find events by category, time, price, crowd size and tags.


Support for user accounts, friends and social sharing (sending events to friends, viewing who is attending, hiding attendance, saving events).


A simple messaging function for users to share events directly within the app.


A mechanism for verified organisers (university clubs, councils, official venues) to submit events.


Prize/reward gamification (e.g. earning “karma” by attending or sharing events).


Background data scraping jobs that collect event information from publicly available Melbourne event websites.  Only sites with permissive robots.txt and terms (e.g., What’s On Melbourne , Museums Victoria , Arts Centre Melbourne , Beat’s gig guide , South Melbourne Market and Federation Square ) are scraped.  Sites with disallow rules or AI‑bot bans (e.g., Humanitix ) are excluded.


The application does not include processing payments for ticket purchases or storing sensitive personal information.  The hackathon scope may omit monetisation (paid event promotions) and in‑depth analytics features.
1.4 Definitions, Acronyms and Abbreviations
Happ – Term used within the code to refer to a single event or activity record.


User – Any person who uses the Happs application (attendee, student, organiser).


Verified organiser – A user with permission to post official events on behalf of an organisation.


Scraper – An automated process that fetches and parses event information from external websites.


Robots.txt – A text file on a website indicating which paths web crawlers may access; this document references scrapability citations to ensure compliance .


2. Overall Description
2.1 Product Perspective
Happs is a new product, not a component of another system.  It comprises a front‑end client (React or similar) served via a web server and a back‑end API that manages data storage, user accounts, event ingestion and recommendation logic.  The back‑end periodically runs scraping jobs to collect events from approved sources.  The app integrates a map service (e.g., Leaflet or Google Maps) for geospatial display.  The interface is responsive so that it works both on desktop and mobile browsers.
2.2 Product Functions
The high‑level functions include:
Event Ingestion and Storage – Scrapers collect data from public event websites and store events in a database with fields such as title, location, description, time, price, category and source.


Map Interface – A map view centered on the user’s location shows event pins and clusters.  Users can select a radius and zoom level; clusters indicate event density.


Feed Interface – A scrolling feed lists events with summaries; can be sorted by time, category or user interest.


Filtering and Search – Users can filter by tags (e.g., sports, music, markets), time frames (now, soon, later), price (free, budget, expensive) and alcohol availability.


Event Details – Clicking an event reveals a detail card with an AI‑generated summary, event description, venue, start/end times, price estimate, busyness rating (quiet, busy, packed) and a link to buy tickets or get more information.


Social Features – Account creation and login, ability to add friends, view how many friends are attending, hide attendance, save events, share events via messaging and external sharing.


Notifications – Users receive notifications for events starting soon, reminders for saved events, and friend activities.


Time Slider – A timeline slider to browse events at different times of the day or week.


Organizer Features – Verified users can create events with fields for title, location, description, date/time, category and crowd forecast; they can view simple analytics (e.g., RSVPs, interest levels) and their past events.


Gamification – Users earn karma points for attending events or inviting friends, unlocking badges and rewards.


2.3 User Classes and Characteristics
Casual Users/Students – Primary audience: university students and young adults seeking spontaneous activities.  They may not log in but can browse events.  They value ease of discovery and quick decision‑making.


Registered Users/Friends – Users who create an account to personalise the experience.  They can add friends, save events, receive notifications and track attendance.


Verified Organisers – Event organisers such as university clubs, venues and local councils who can submit events.  They need a straightforward submission interface and basic analytics.


Administrators – Internal team members who manage user accounts, approve organiser verification, handle abuse reports and monitor scraping jobs.


2.4 Operating Environment
Client – The app runs in modern web browsers (Chrome, Firefox, Safari, Edge) on desktop (Windows, macOS, Linux) and mobile (iOS, Android).


Server – The back‑end runs on a cloud platform (e.g., AWS, GCP) with Node.js or Python.  A relational database stores event and user data.  Scheduled cron jobs run scraping tasks.


Map Provider – The app uses an external mapping service (e.g., Leaflet with OpenStreetMap tiles or Google Maps) that supports geocoding and clustering.


Data Sources – External websites provide event listings.  Only scrapable paths are used .


2.5 Design and Implementation Constraints
Scraping compliance – The app must respect each source’s robots.txt; only sources with permissive rules (What’s On Melbourne , Museums Victoria , Arts Centre Melbourne , Beat gig guide , South Melbourne Market , Federation Square ) are scraped.  Sources with AI‑bot bans or heavy disallows (e.g., Humanitix ) are excluded.


Responsive design – The UI must scale to various screen sizes with intuitive touch controls on mobile and mouse interactions on desktop.


Data freshness – Scraper jobs run at least once per day; events older than a configurable threshold are automatically archived.


Privacy – The app must store only necessary personal data; it will not share exact user locations or sell data.  Event suggestions are based on anonymised preferences.


Security – All communication uses HTTPS; user passwords are salted and hashed.  Third‑party authentication (OAuth) may be used for login.


Performance – The map should load quickly with efficient clustering.  The server should handle high concurrency for scrapers and client requests.


Extensibility – The data ingestion layer should allow adding new scraping adapters with minimal changes.


2.6 User Documentation
User documentation will include:
A quick‑start guide accessible within the app explaining how to navigate the map, search for events, save and share events, and manage notifications.


A FAQ page on the website addressing privacy, data sources and organiser verification.


Submission guidelines for organisers outlining event posting requirements and restrictions.


2.7 Assumptions and Dependencies
Users have internet connectivity and geolocation services enabled to get local events.


External sources remain publicly accessible and maintain consistent HTML structures; changes may require scraper updates.


Map services remain free or within acceptable usage limits for the hackathon; long‑term usage may incur costs.


University clubs and organisers provide accurate data for events.


3. Specific Requirements
3.1 Functional Requirements
The following requirements use the “shall” keyword to denote mandatory functionality and “should” for desirable features.
3.1.1 Event Ingestion
Source Compliance – The system shall fetch event data only from websites with permissive robots.txt or explicit API access .


Scraping Adapters – For each approved source, the system shall implement a separate adapter to extract title, date/time, location, description, categories/tags, price and source URL.


Scheduling – Scraper jobs shall run at configurable intervals (default: every 24 hours) via cron.


Data Normalisation – Scraped events shall be normalised into a common schema.


Duplication Handling – The system shall detect and merge duplicate events using fuzzy matching on title, time and location.


Error Logging – All scraping errors shall be logged and reported to administrators.


3.1.2 Map Interface
Geolocation – Upon loading, the app shall request user permission for location to centre the map; if denied, the user can manually set a location.


Pin Display – Events shall be displayed as pins using category‑specific icons.  When zoomed out, multiple pins shall cluster with a label showing the number of events.


Radius Selection – Users shall be able to set a search radius (e.g., 500 m, 1 km, 3 km) and view only events within that distance.


Hover/Tap – Clicking or tapping a pin shall open a summary card with basic details.


Time Slider – A slider shall enable browsing events across different time windows (e.g., morning, afternoon, evening, specific days).


3.1.3 Feed and Search
Feed Sorting – Users shall view a feed of events sorted by start time or relevance.  They should be able to switch between list and grid views.


Search – Users shall search for events by keywords, tags, venues or organisers.


Filter Controls – The app shall provide filter options for categories (sports, music, markets, hikes), price (free, budget, premium), time (today, this week), alcohol availability (alcoholic, non‑alcoholic) and busyness level.


Happening Soon – A quick filter shall show events starting within a configurable time window (e.g. within 1 hour).


3.1.4 Event Details and Actions
Event Card – The system shall display detailed information: title, description (summarised by AI), venue, date/time, ticket link, price estimate, crowd forecast, spontaneity score and tags.


Save Event – Registered users shall be able to save events to a personal list.


Share Event – Users shall share events via in‑app messaging or external social media.


RSVP/Check‑in – Registered users may indicate they plan to go (“I’m going”) or check in (“I’m here”).  Attendance shall be hidden from friends if the user chooses.


Report Event – Users shall be able to report inaccurate or inappropriate events to administrators.


3.1.5 User Account and Social Features
Registration/Login – Users shall register with email/password or third‑party OAuth (Google, Apple).  Passwords shall be hashed and salted.


Friend System – Users shall send friend requests, accept or decline them, and see a list of friends.


Privacy Settings – Users shall control whether friends can see their attendance status or saved events.


Messaging – Users shall send direct messages containing event links.  The system shall store conversation history.


Karma Points – The app shall award points for actions like attending events, inviting friends and adding reviews; these points shall unlock badges and rewards.


3.1.6 Organiser Features
Verification Workflow – Organisers shall request verification by providing organisational details (email domain, official websites).  Administrators shall approve or reject requests.


Event Submission – Verified organisers shall create events with required fields: title, description, location, start time, end time and category.  Optional fields include price, photos and maximum capacity.


Edit/Delete – Organisers shall edit or cancel their events.


Analytics – Organisers should view metrics: number of saved events, RSVPs, check‑ins, demographic breakdown (anonymised) and event popularity over time.


3.1.7 Notifications
Event Reminders – The system shall send notifications when a saved event is starting in 1 hour and 20 minutes.


Friend Activity – Users shall receive notifications when friends RSVP or check in (if privacy settings allow).


New Events – Users may opt in to receive notifications about new events matching their interests.


3.2 External Interface Requirements
3.2.1 User Interface
The UI shall be responsive, adjusting layout and font sizes for mobile and desktop.


Colour schemes shall conform to accessibility guidelines (sufficient contrast, optional dark mode).


The map shall support pinch‑to‑zoom on touch devices and scroll‑to‑zoom on desktop.


Forms for sign‑up, event submission and messaging shall be intuitive and validated client‑side.


The navigation bar shall include: Map, Feed, Profile, Messages and Search.


3.2.2 Hardware Interface
No special hardware is required; the app shall run on devices with web browsers.


Mobile devices must support geolocation (GPS) for best experience; location permission is optional.


3.2.3 Software Interface
Back‑end API – The front‑end shall interact with the back‑end using REST or GraphQL endpoints over HTTPS.  APIs include event retrieval, user management, friend management, messaging, notifications and organiser actions.


Database – The system shall use a relational database (PostgreSQL or MySQL) with geospatial extensions (e.g., PostGIS) for efficient location queries.


Third‑Party Services – The app may integrate:


Map provider for tile layers and geocoding.


OAuth providers for login.


Notification service (e.g., Firebase) for push notifications.


3.2.4 Communications Interface
All communications shall be over secure HTTPS.  Real‑time features (messaging, live check‑ins) may use WebSockets or a real‑time database (e.g., Firebase Realtime Database).
3.3 Performance Requirements
Response Time – Map view should load with pins within 2 seconds on a 4G mobile connection.  Search queries should return results in under 1 second from the server.


Concurrency – The back‑end should support at least 1 000 concurrent user sessions for the hackathon prototype, scalable via cloud infrastructure.


Scraper Throughput – A scraping job should process at least 10 000 events per run, with rate limiting to avoid source blocking.


3.4 Design Constraints
The application shall comply with privacy legislation (e.g., Australian Privacy Principles) and not collect personal data beyond what is necessary for user accounts and friend connections.


Only publicly available event data from authorised sources shall be scraped.  For sites like Humanitix that explicitly forbid AI bots , the app shall not scrape their content.


The hackathon implementation shall avoid payment processing; monetisation features (event promotion boost) are deferred to future releases.


The system shall be open to expansion to other cities or event categories in future, so code should be modular.


3.5 Non‑Functional Requirements
Security – Data in transit shall be encrypted; user passwords hashed.  Access control ensures only authenticated users perform restricted actions.  Content moderation shall remove inappropriate events.


Usability – The app shall be intuitive; new users should discover events within 30 seconds of opening the map.  Clear visual cues (icons, colours) indicate categories.  Help tips explain controls.


Reliability – The system shall achieve 99 % uptime for the core services during the hackathon demonstration.  Scraper failures shall not crash the user‑facing app.


Maintainability – Code should follow best practices; front‑end and back‑end codebases shall be documented and include unit tests.  Scrapers should be configurable and support easy updates.


Portability – The app shall run on common browsers without plugins.  The back‑end should be containerised for deployment on different cloud providers.


Scalability – The design shall allow scaling of the back‑end (e.g., horizontally scaling API servers) and the database (read replicas, sharding) as user base grows.


3.6 Attributes



HAPS MAP:


Blurb:
Hapsmap is a mobile/web app that turns discovering things to do into an interactive experience.
Users open the app directly to the MAPS page
Additional pages for a feed that users can scroll
Messaging function where users can send events to each other.
Verified accounts can submit current/future events.(Clubs, University…)
Prize/Reward system, more events = more karma …

Key Features:
Maps - think of apple photos maps
Scroll around the map and more events load in
can select a specific radius for events
can put in a specific suburb or location for activities and then select radiusat
Descriptions of events - Ai summary for the event details
link for more information/to buy tickets
Expenses predictor
Tags to events that helps with sorting and the algorithm for recommendations
Event Clusters?
When zoomed out, pins clusters into events with a small number showing how many events in this area
like how apple photos maps does it
Sort between specific types of activities
Alcoholic/Non Alcoholic
Sports
Music
Late night
Day Activities
Expense sorter
Free only toggle
“Happening Soon” - Activities that are happening in ‘x’ amount of time
Users
Friends / social network
Ability to see how many friends are going to an event
ability to hide if you are going to an event
Verified users that can add events
Be able to save events
Be able to share events
“Who’s here”
Users can check which of their friends are at an event
Notifications
Event starts in 1 hour / 20 minutes
Time slider
Users can slide through the time of day or week to check which activities occur at what time

Organizer Features
a way to help event creators to post “haps”
Fields
title
location
description
time
category
Crowd Forecast
RSVPs
interests
Past events
Event Promotion Boost
Organizers can pay to boost events (DONT INCLUDE IN HACKATHON)
“Analytics Features”
shows how many events you have been to in the last week/month/year
city activity trends
fridays peak nightlife
sundays: markets and sports




















Scrape:

https://whatson.melbourne.vic.gov.au
https://www.monash.edu/events
https://www.monashclubs.org
https://events.unimelb.edu.au/
https://www.rmit.edu.au/events
https://www.meetup.com
https://www.timeout.com/melbourne
https://www.austadiums.com/city/melbourne/events
https://www.palaistheatre.com.au/whats-on
https://www.cricket.com.au/matches?year=2026&isCompleted=0
https://www.mcg.org.au/events
https://www.nbl.com.au/schedule?c4895a7e_page=2
https://www.melbournepark.com.au/events/
https://connect.ngv.vic.gov.au/
https://museumsvictoria.com.au/melbournemuseum/whats-on/
https://www.artscentremelbourne.com.au/whats-on/event-calendar
https://www.acmi.net.au/whats-on/
https://beat.com.au/gig-guide/
https://fedsquare.com/whats-on
https://www.monash.edu/students/campus-life/events
University events
Sporting
Music/Concerts
Sunday Markets
Hikes/Walks


etc. Council Events













List of All features:

Maps - think of apple photos maps
Scroll around the map and more events load in
can select a specific radius for events
can put in a specific suburb or location for activities and then select radius
Icons
Descriptions of events - Ai summary for the event details
link for more information/to buy tickets
Expenses predictor
Tags to events that helps with sorting and the algorithm for recommendations
Sort between specific types of activities
Alcoholic/Non Alcoholic
Sports
Music
Late night
Day Activities
Expense sorter
Free only toggle
“Happening Soon” - Activities that are happening in ‘x’ amount of time
“Hidden Gems”
High Rating
Low Attendance
Nearby?
Heat Map / Overlays
Satellite view - heatmap to see where most events are
Heat map view to see what is very popular around the city
Heatmap of past events, like where you and your friends have been mostly
Users
Friends / social network
Ability to see how many friends are going to an event
ability to hide if you are going to an event
Verified users that can add events
Be able to save events
Be able to share events
Notifications
Event starts in 1 hour / 20 minutes
“Tonight Planner” / “Haps Planner”
App generates a mini itinerary of what to do
6:30 do this, 9:00 eat here, 12:00 take uber here

Weather Aware Suggestions??
If its sunny suggest outdoor stuff
if its raining suggest indoor stuff
Trending Events
Spontaneity Score
Score that checks when the event
distance
price
popularity
gives a single score recommending how good it is to go to
“Who’s here”
Users can check which of their friends are at an event
Event Chat?
Users can be in a temporary chat room and ask questions??
Time slider
Users can slide through the time of day or week to check which activities occur at what time
Event Clusters?
When zoomed out, pins clusters into events with a small number showing how many events in this area
like how apple photos maps does it
Organizer Features
a way to help event creators to post “haps”
Fields
title
location
description
time
category
Crowd Forecast
RSVPs
interests
Past events
Event Promotion Boost
Organizers can pay to boost events (DONT INCLUDE IN HACKATHON)
“I’m bored” button - “dead haps”
click a button to immediately find haps near you, can keep rolling through different events

“Adventure Mode”
Users choose specific things like: distance, money, time, energy
then app gives a random recommended event
“Mystery Night”
Gives a surprise itinerary one event at a time that users have to follow for a mystery and fun night
“City Personality Map”
Showing which areas/suburbs of the city are known for what
Fitzroy - arts
southbank - culture
carlton - food
“Leaving Now Button”
A button that notifies ur friends who are going to the event when you are leaving and approximately what time you arrive, instead of having to message each one and waiting for replies
“Analytics Features”
shows how many events you have been to in the last week/month/year
city activity trends
fridays peak nightlife
sundays: markets and sports
Group Planning with friends
CHATGPT STRONGLY RECOMMENDS A TIME SLIDER



App spec
Name: Happs
Web app for finding nearby events and activities - a spontaneous boredom solver
The app has a map UI with popups for events in your local area (Australia/Melbourne, can be expanded)
Features for filtering price, busyness, “dead”ness as well as spontaneity scoring for events
The app scrapes websites like WhatsOnMelbourne and EventBrite to populate the map using a cron job and Gemini for HTML parsing to JSON objects
User accounts can support friends with features
Each event should be called a “happ” in the code (if this is implementation is necessary)
Verified user accounts can post events (University events, clubs & teams)
A “go on a side quest” button is present to suggest a suitable event for the user
Friend analytics like “how many people are going” should be present

















Video Ideas:













