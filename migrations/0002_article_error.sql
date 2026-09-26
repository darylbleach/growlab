-- articles.error stores the last publish failure (X API / conversion / cover).
-- articles.x_article_id is the X Article id from POST /2/articles/draft (data.id),
-- not the seed post_id returned by POST /2/articles/{id}/publish.
ALTER TABLE articles ADD COLUMN error TEXT;
