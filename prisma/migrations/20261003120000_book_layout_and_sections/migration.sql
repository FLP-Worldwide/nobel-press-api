ALTER TABLE `BookChapter` MODIFY `type` ENUM('chapter', 'intro', 'preface', 'section') NOT NULL;
ALTER TABLE `BookDesign` ADD COLUMN `layoutStyle` VARCHAR(40) NULL;
