const request = require('superagent');
const promise = require('promised-io/promise');
const validator = require('validator');
const ytdl = require('ytdl-core');
const moment = require('moment');
const fs = require('fs');

module.exports = class Youtube
{
    /**
     *
     * @param token
     * @param base_url
     */
    constructor(token, base_url)
    {
        this.token = token;
        this.base_url = base_url;
    }

    /**
     * @param source
     * @param path
     * @returns {Promise.<Promise|PromiseConstructor>}
     * @private
     */
    async download(source, path)
    {
        let deferred = promise.defer();
        ytdl(source, {quality: 'lowest', filter: 'audioonly', retries: 5})
            .pipe(
                fs.createWriteStream(path).on('close', () => {
                    deferred.resolve();
                })
                .on('error', (e) => {
                    deferred.reject(e);
                })
            );

        return deferred.promise;
    }

    /**
     * Returns formatted track data as an object
     * @param track
     * @returns {{title, source: string, image, description, url: string, duration: null}}
     * @private
     */
    _constructTrackObject(track)
    {
        let duration = moment.duration(track.contentDetails.duration);
        let image = null;

        if (track.snippet.thumbnails.default) image = track.snippet.thumbnails.default.url;
        if (track.snippet.thumbnails.medium) image = track.snippet.thumbnails.medium.url;
        if (track.snippet.thumbnails.standard) image = track.snippet.thumbnails.standard.url;
        if (track.snippet.thumbnails.high) image = track.snippet.thumbnails.high.url;
        if (track.snippet.thumbnails.maxres) image = track.snippet.thumbnails.maxres.url;

        return  {
            title: track.snippet.title,
            source: `Youtube`,
            image: image,
            description: track.snippet.description,
            url: `${this.base_url}/watch?v=${track.id || track.id.videoId}`,
            duration:`${duration.hours()< 10 ? '0' : ''}${duration.hours()}:${duration.minutes() < 10 ? '0' : ''}${duration.minutes()}:${duration.seconds() < 10 ? '0' : ''}${duration.seconds()}`,
            added_by: null,
        }
    }

    /**
     * @param query
     * @param results
     * @returns {Promise.<Promise|PromiseConstructor>}
     */
    async search(query, results = 50)
    {
        let queryIsPlaylist = validator.isURL(query) && query.indexOf('list=') > -1;
        if (queryIsPlaylist) return this.getPlaylistVideos(query);
        else if (validator.isURL(query)) return this._getVideos(query);
        else {
            let deferred = promise.defer();
            let requestUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&key=${this.token}&type=video`;
            request(requestUrl, async (error, response) => {
                if (response.statusCode === 200) {
                    let sliced = response.body.items.slice(0, results);
                    let ids = [];
                    for (let track of sliced) ids.push(track.id.videoId);
                    let videos = (await this._getVideos(ids.join(',')));
                    deferred.resolve(videos);
                }
                else if (response.statusCode === 404) deferred.resolve([]);
                else deferred.reject(response);
            });

            return deferred.promise;
        }
    }

    /**
     * @param url
     * @param limit
     * @returns {Promise.<Array>}
     */
    async getPlaylistVideos(url, limit = 500)
    {
        if (validator.isURL(url) === false) throw 'Incorrect playlist URL';
        let results = [];
        let playlistID = url.split('list=')[1];

        if (playlistID) {
            let requestUrl = `https://www.googleapis.com/youtube/v3/playlistItems?maxResults=50&part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistID)}&key=${this.token}`;
            let response = await this._singlePagePlaylistSearch(requestUrl.trim());
            results = results.concat(response.items);

            while (response && response.nextPageToken && results.length + 100 < limit) {
                response = await this._singlePagePlaylistSearch(requestUrl.trim(), response.nextPageToken);
                results = results.concat(response.items);
            }
        }

        return results;
    }

    /**
     *
     * @param url
     * @param page
     * @returns {Promise|PromiseConstructor}
     * @private
     */
    _singlePagePlaylistSearch(url, page = null)
    {
        let deferred = promise.defer();
        let results = {total : null, items: [],  nextPageToken: null};
        let requestURL = url.trim();

        if (page) requestURL = url.trim() + '&pageToken=' + page;

        request(requestURL, async (error, response) => {

            if (!error && response.statusCode === 200) {
                results.total = response.body.pageInfo.totalResults;
                results.nextPageToken = response.body.nextPageToken;

                let deeperRequestIDS = [];
                for (let item of response.body.items) {
                    if (!item.contentDetails.duration) deeperRequestIDS.push(item.snippet.resourceId.videoId);
                    else results.items.push(this._constructTrackObject(item));
                }

                // splitting deeperRequestIDS array into three chunks to avoid exceeding form request limit
                // for each chunk of ids we send additional video data request to get the damn duration...
                let chunks = this._chunkArray(deeperRequestIDS, 4);
                for (let idsChunk of chunks) results.items = results.items.concat(await this._getVideos(idsChunk.join(',')));
                deferred.resolve(results);
            }
            else if (response.statusCode === 404) deferred.resolve(results);
            else {
                console.log(error);
                deferred.reject(response);
            }
        });

        return deferred.promise;
    }

    /**
     *
     * @param query
     * @returns {PromiseConstructor | Promise}
     * @private
     */
    _getVideos(query)
    {
        let deferred = promise.defer();
        if (validator.isURL(query)) query = query.split('=')[1];
        let requestURL = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${query}&key=${this.token}`;
        request(requestURL, async (error, response) => {
            let tracks = [];
            if (!error && response.statusCode === 200) {
                for (let item of response.body.items) tracks.push(await this._constructTrackObject(item));
                deferred.resolve(tracks);
            } else deferred.reject(response);

        });

        return deferred.promise;
    }

    /**
     * Basically splits array into array of arrays specified by Size
     * @param array
     * @param size
     * @returns {Array}
     * @private
     */
    _chunkArray(array, size)
    {
        let results = [];
        while (array.length) results.push(array.splice(0, size));
        return results;
    }

};