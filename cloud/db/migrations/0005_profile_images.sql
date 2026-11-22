CREATE TABLE auth_profiles (
    subject TEXT PRIMARY KEY REFERENCES auth_users(subject) ON DELETE CASCADE,
    picture TEXT NOT NULL
);
