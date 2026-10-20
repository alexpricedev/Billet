# Reset a forgotten password (password mode)

As a returning user (Priya) on a phone, I want to reset my password so that I can sign in again.
Starting from `/login`, signed out, `AUTH_MODE=password`.
Done when Priya sets a new 12+ character password from the emailed link and lands signed in.
I expect the request to say "sent" whether or not the account exists, a short password to be refused with the rule, and a used link to say it has expired.
