1. User Roles
There are three user roles in the system.
Regular Users are the default account type. They can discover events, RSVP to events, save events, add friends, see which friends are attending events, share events, adjust privacy settings, and receive notifications.
Verified Organizers are accounts used by businesses or official event hosts. These accounts can create, edit, and delete their own events. They also have access to analytics such as RSVP counts, views, and attendance predictions.
Administrators are internal system moderators. They can verify organizer accounts, remove events, ban users, edit incorrect event details, and manage reports.

2. Authentication System
Users must be able to create an account and log in through multiple methods.
Supported login methods should include:
Email and password


Google OAuth login


Apple OAuth login


When creating an account the user should provide a username, email, and password unless using OAuth. OAuth accounts should automatically create a user profile using the account name and profile image.
Basic security requirements include password hashing, email verification, and rate limiting for login attempts.
3. User Profiles
Each user has a profile page.
The profile displays the user’s username, profile picture, optional bio, mutual friends, events they are attending (if visible), and events they have attended previously.
Users should be able to edit their profile details including username, profile picture, bio, and interests.
The profile should also display user statistics such as how many events they have attended recently.
Privacy settings determine which parts of the profile are visible to others.
4. Friends and Social Network
Users can add each other as friends to form a social network inside the app.
Users should be able to send friend requests, accept friend requests, decline friend requests, remove friends, block users, and see mutual friends.
Once two users become friends they can see each other's public event activity depending on privacy settings.
Users should also be able to organise friends into custom friend groups called Close Friends. This group is used to control who can see certain event attendance.
5. Event Attendance System
Users can interact with events through three states: Interested, Going, or Not Going.
Interested means the user is considering the event. Going means the user plans to attend.
When viewing an event page the system should show how many friends are interested or going to the event. For example, the page might show “3 friends are going” or “8 friends are interested”.
Can see multiple avatars hovering over the locations.
Clicking this indicator should reveal a list of those friends.
This feature encourages social discovery because users can find events through their friends.
6. Event Privacy Controls
Users must be able to control who can see their attendance status for each event.
Privacy options should include Public (everyone can see), Friends Only, Close Friends Only, and Only Me.
For example, a user might mark themselves as going to an event but restrict visibility so that only their close friends can see it.
There should also be a hidden attendance option, sometimes referred to as Ghost Mode. In this mode the user can RSVP to the event but their attendance will not be visible to anyone else.
7. Saving and Organizing Events
Users should be able to save events they are interested in attending later.
Saved events appear in a personal list called Saved Events.
Users should also be able to organize saved events into collections. Example collections might include Weekend Plans, Food Events, or Live Music.
This feature helps users plan future activities.
8. Event Sharing
Users must be able to share events with others.
Sharing options include copying a link to the event page, sending the event directly to friends inside the app, or sharing externally through apps like WhatsApp, Instagram, or messaging.
Shared links should open the event page inside the web version.
9. Event Check-In (“Who’s Here” Feature)
Users should be able to check in when they physically arrive at an event.
Once checked in, the event page should display how many people are currently at the event and how many of those are friends.
For example the event page might show “18 people here now” and “4 friends here”.
Check-ins automatically expire when the event ends.
This feature allows users to estimate crowd size and see whether their friends are currently at the event.
10. Notification System
Users should receive notifications related to events and social activity.
Event reminder notifications should alert the user when an event they marked as going or interested in is approaching. Examples include notifications one hour before the event starts or twenty minutes before the event begins.
Social notifications should inform users when friends interact with events. For example, the user might receive a notification saying “Alex is going to Jazz Night” or “3 friends are attending the Night Market”.
The system should also notify users about new events near their location or new events posted by organizers they follow.
Notifications should be available as in-app notifications and push notifications. Email notifications can optionally be added later.
Users should be able to customize which types of notifications they receive.
11. Verified Organizer Accounts
Verified organizers are users who have been approved by administrators to host official events.
These accounts typically belong to event companies, venues, student clubs, festivals, or local organizations.
Verified organizers should have a badge displayed on their profile to indicate authenticity.
Organizers must be able to create events, edit events, delete events, and view analytics for their events.
Only verified organizer accounts should be able to create events in the system.

12. Event Creation System
When an organizer creates an event they must provide several fields.
These include the event title, description, location name, address, start time, end time, category, tags, ticket link if applicable, event image, price range, and age restriction if relevant.
Categories might include music, nightlife, sports, food, culture, university, and outdoor events.
Events should appear on the map immediately after creation.

13. Organizer Dashboard
Verified organizers should have access to a dashboard that displays information about the events they created.
The dashboard should show the total number of views on the event page, the number of users who marked the event as interested, the number of users who marked themselves as going, and the number of check-ins during the event.
This dashboard helps organizers understand event engagement.
14. Crowd Forecast System
The system should estimate how busy an event will be.
The forecast can be calculated using signals such as the number of users who marked the event as interested, the number who marked themselves as going, check-in data, and attendance data from past events by the same organizer.
The forecast can be displayed as a simple label such as Low Crowd, Medium Crowd, or High Crowd.
This gives users an idea of how busy the event might be.
15. User Analytics
Users should be able to view personal activity analytics.
Examples include the number of events attended in the past week, month, or year, the most common event categories they attend, and total events attended.
These analytics make the platform more engaging and give users a sense of activity history.

16. Social Discovery Features
The system should include a few features that encourage social discovery.
A Friend Heatmap can show which areas of the city have the most friends attending events tonight.
An Activity Feed can display updates such as friends marking themselves as going to events or saving events.
For example the feed might show messages like “Sarah is going to Comedy Night” or “3 friends are attending the Night Market”.
These updates help users discover events through their network.
17. Safety and Moderation
Users must be able to report events or report other users if necessary.
Users should also be able to block other users to prevent interaction.
Administrators must be able to review reports and remove inappropriate events or accounts.
Basic security protections should include email verification and rate limiting for login attempts.

19. User Interest Selection (Onboarding)
When a user creates an account for the first time, they must select at least three interests during onboarding. This helps personalise the events shown on their map and improves event recommendations.
The user should be presented with a list of interest categories similar to the onboarding system used in X. Examples of interests include music, nightlife, sports, food, festivals, comedy, markets, art and culture, university events, technology, networking, outdoor activities, fitness, and gaming.
Users must choose a minimum of three interests before continuing, but they may select more if they wish. These interests are stored in their profile and used to prioritise relevant events and notifications. Users should also be able to update their interests later in their profile settings.



