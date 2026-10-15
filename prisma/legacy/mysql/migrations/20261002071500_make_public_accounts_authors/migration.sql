-- The product currently has one public registration journey: self-publishing.
-- Existing public accounts used that journey but were stored as buyers, which
-- caused a 403 immediately after login. Admin accounts remain unchanged.
UPDATE `User`
SET `role` = 'author'
WHERE `role` = 'buyer';

ALTER TABLE `User`
  MODIFY `role` ENUM('author', 'buyer', 'admin') NOT NULL DEFAULT 'author';
