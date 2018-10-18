
(function(){
    if (get_global('SElib') !== undefined)
        return;
    set_global('SElib', true);

    function _build_event(self, callbacks, start_func, stop_func){
        function register(func){
            callbacks.push(func);
            if (callbacks.length === 1)
                start_func.call(self);
        }
        function unregister(func){
            let index = callbacks.indexOf(func);
            callbacks.splice(index, 1);
            if (callbacks.length === 0)
                stop_func.call(self);
        }

        return {register: register,
                unregister: unregister};
    }

    function _build_filtered_event(event, filter){
        let callbacks = new Map();

        function register(func){
            function callback(){
                if (filter(...arguments))
                    func(...arguments);
            }

            callbacks.set(func, callback);

            event.register(callback);
        }
        function unregister(func){
            let callback = callbacks.get(func);
            callbacks.delete(func);

            event.unregister(callback);
        }

        return {register: register,
                unregister: unregister};
    }

    
    const _users_by_id = new Map();

    set_global('Rerun', {
        NEVER: 1,
        AFTER_CHANGE: 2,
    });
    
    set_global('PostActionsMixin', Base => class PostActionsMixin extends Base {
        get _key(){
            return StackExchange.options.user.fkey;
        }
    });

    set_global('QuestionActionsMixin', Base => class QuestionActionsMixin extends PostActionsMixin(Base) {
        load_tags(){
            const url = document.location.origin + '/posts/' + this.id + '/edit-tags';

            function extract_tags(req){
                const html = req.response;
                const elem = html.querySelector('#tagnames');
                const tags = elem.value.split(' ');
                return Array.from(tags);
            }

            return async_xhr_get(url, true).then(extract_tags);
        }

        set_tags(tags){//FIXME: nothing I try works
            const url = document.location.origin + '/posts/' + this.id + '/edit-tags';

            const form = new FormData();
            form.set('fkey', this._key);
            form.set('reviewTaskId', undefined);
            form.set('tagnames', tags.join('+'));

            return async_xhr_post(url, form);
            
            // const form = document.createElement('form');
            // form.action = '/posts/'+this.id+'/edit-tags';
            // form.method = 'post';
            // form.target = '_blank';
            // form.innerHTML = '<input type="text" name="fkey" value="'+StackExchange.options.user.fkey+`" />
            // <input type="text" name="reviewTaskId" value="undefined" />
            // <input type="text" name="tagnames" value="`+tags.join(' ')+`" />
            // `;
            // form.submit();
        }
    });

    set_global('AnswerActionsMixin', Base => class AnswerActionsMixin extends PostActionsMixin(Base) {
    });

    set_global('PageBase', class PageBase extends ElementWrapper {
        constructor(){
            super(document);
        }
    });

    set_global('QuestionListPage', class QuestionListPage extends PageBase {
        constructor(){
            super();
        }

        list_questions(){
            const questions = [];
            for (const elem of self.getElementsByClassName('question-summary')){
                const question = QuestionSummary.from_element(elem);
                questions.push(question);
            }

            return questions;
        }
    });

    set_global('QuestionSummary', class QuestionSummary extends QuestionActionsMixin(IDElementWrapper) {
        constructor(element){
            super(element);

            this._author = null;
            this._tags = null;
        }

        static _get_id(element){
            return element.id.split('-')[2];
        }

        get author(){
            if (this._author === null){
                const elem = this.querySelector('.user-info');
                this._author = User.from_element(elem);
            }

            return this._author;
        }

        get tags(){
            if (this._tags === null){
                const taglist = this.querySelector('.tags');

                const tags = [];
                for (const elem of taglist.getElementsByTagName('a'))
                    tags.push(elem.textContent);

                this._tags = tags;
            }

            return this._tags;
        }
    });
    QuestionSummary._instances_by_id = new Map();

    set_global('QuestionPage', class QuestionPage extends PageBase {
        constructor(){
            super();

            this._question = null;
            this._answers = null;

            this._on_answer_added_callbacks = [];
            this.on_answer_added = _build_event(this,
                                                this._on_answer_added_callbacks,
                                                this._on_answer_added_start,
                                                this._on_answer_added_stop);

            this._after_post_change_callbacks = [];
            this.after_post_change = _build_event(this,
                                                  this._after_post_change_callbacks,
                                                  this._after_post_change_start,
                                                  this._after_post_change_stop);

            this.after_question_change = _build_filtered_event(this.after_post_change,
                                                               p => p.constructor === Question);
            this.after_answer_change = _build_filtered_event(this.after_post_change,
                                                             p => p.constructor === Answer);

            this._on_comment_added_callbacks = [];
            this.on_comment_added = _build_event(this,
                                                 this._on_comment_added_callbacks,
                                                 this._on_comment_modification_start,
                                                 this._on_comment_modification_stop);

            this._after_comment_change_callbacks = [];
            this.after_comment_change = _build_event(this,
                                                     this._after_comment_change_callbacks,
                                                     this._on_comment_modification_start,
                                                     this._on_comment_modification_stop);

        }

        get question(){
            if (this._question === null)
                this._question = Post.from_element(this.getElementById('question'));
            return this._question;
        }

        get answers(){
            const answers = Array.from(document.getElementsByClassName('answer'));
            this._answers = answers.map(ans => Post.from_element(ans));
            return this._answers;
        }

        get posts(){
            return [this.question, ...this.answers];
        }

        _on_answer_added_start(){
            this._on_answer_added_listener = this._check_answer_added.bind(this);
            document.addEventListener('click', this._on_answer_added_listener, true);
        }
        _on_answer_added_stop(){
            document.removeEventListener('click', this._on_answer_added_listener, true);
            this._on_answer_added_listener = undefined;
        }
        _check_answer_added(event){ // FIXME: the current implementation doesn't detect self-written answers
            var elem = event.target;
            if (elem.tagName === 'A')
                elem = elem.parentElement;

            if (elem.id !== 'new-answer-activity')
                return;

            const answers_elem = document.getElementById('answers');
            // fetch the current answers so we can later find new ones
            const current_answers = this.answers.slice();
            const self = this;

            function find_new_answers(){
                for (const answer of self.answers){
                    if (current_answers.includes(answer))
                        continue;

                    for (const callback of self._on_answer_added_callbacks)
                        callback(answer);
                }
            }

            const config = {childList: true, subtree: true};
            run_after_last_mutation(find_new_answers, 250, answers_elem, config);
        }

        _after_post_change_start(){
            this._on_post_change_listener = this._check_post_change.bind(this);
            document.addEventListener('click', this._on_post_change_listener, true);
        }
        _after_post_change_stop(){
            document.removeEventListener('click', this._on_post_change_listener, true);
            this._on_post_change_listener = undefined;
        }
        _check_post_change(event){
            // FIXME: When an edit has been made and new comments have been posted,
            // loading the new comments automatically loads the edit as well.
            // This function does NOT detect that.

            var elem = event.target;
            if (elem.tagName === 'A')
                elem = elem.parentElement;

            if (elem.tagName === 'INPUT'){
                if (elem.value !== 'Save Edits')
                    return;
            } else {
                if (!elem.classList.contains('new-post-activity'))
                    return;
            }

            const post = Post.from_child_element(elem);
            const self = this;

            function trigger_callbacks(){
                for (const callback of self._after_post_change_callbacks)
                    callback(post);
            }
            const config = {childList: true, subtree: true};
            run_after_last_mutation(trigger_callbacks, 500, post.element, config);
        }

        _on_comment_modification_start(){
            if (this._on_comment_modification_listener !== undefined)
                return;

            this._on_comment_modification_listener = event => this._check_comment_modifications(event);
            document.addEventListener('click', this._on_comment_modification_listener, true);
        }
        _on_comment_modification_stop(){
            // since this listener is shared by 2 different events, only disconnect
            // it if neither event has any callbacks
            if (this._on_comment_added_callbacks.length + this._after_comment_change_callbacks.length > 0)
                return;

            document.removeEventListener('click', this._on_comment_modification_listener, true);
            this._on_comment_modification_listener = undefined;
        }
        _check_comment_modifications(event){ // FIXME: the current implementation doesn't detect self-written comments
            const elem = event.target;
            if (!elem.classList.contains('js-show-link')
                    || ! elem.classList.contains('comments-link'))
                return;

            const parent_elem = find_parent(elem, e => e.classList.contains('post-layout'));
            const comments_elem = parent_elem.querySelector('.comments');

            const post = Post.from_child_element(comments_elem);
            // fetch the current comments so we can later tell which comments were added
            const _c = post.comments;

            const self = this;

            function on_dom_mutation(mutations, observer){
                for (const mutation of mutations){
                    for (const node of mutation.addedNodes){
                        if (node.nodeType !== Node.ELEMENT_NODE)
                            continue;

                        // the last change that the observer registers for each
                        // comment is the comment-link being modified
                        if (node.tagName !== 'A' || !node.classList.contains('comment-link'))
                            continue;

                        let comment = Comment.from_child_element(node);
                        if (post._comments.includes(comment)){
                            // an existing comment was reloaded
                            for (const callback of self._after_comment_change_callbacks)
                                callback(comment);
                        } else { // a new comment was added
                            post._comments.push(comment); // FIXME: insert it at the right index

                            for (const callback of self._on_comment_added_callbacks)
                                callback(comment);
                        }
                    }
                }
            };

            const observer_config = {childList: true, subtree: true};
            const observer = create_timeout_MutationObserver(on_dom_mutation, 500);
            observer.observe(comments_elem, observer_config);
        }

        transform_posts(transform_func, rerun){
            this.posts.forEach(transform_func);
            this.on_answer_added.register(transform_func);

            if (rerun === Rerun.AFTER_CHANGE)
                this.after_post_change.register(transform_func);
        }

        transform_answers(transform_func, rerun){
            this.answers.forEach(transform_func);
            this.on_answer_added.register(transform_func);

            if (rerun === Rerun.AFTER_CHANGE)
                this.after_answer_change.register(transform_func);
        }

        transform_question(transform_func, rerun){
            transform_func(this.question);

            if (rerun === Rerun.AFTER_CHANGE){
                function callback(post){
                    if (post.is_a(Question))
                        transform_func(post);
                }
                this.after_post_change.register(callback);
            }
        }

        transform_comments(transform_func, rerun){
            for (const post of this.posts)
                post.comments.forEach(transform_func);
            this.on_comment_added.register(transform_func);

            if (rerun === Rerun.AFTER_CHANGE)
                this.after_comment_change.register(transform_func);
        }

        transform_answer_text_before_submit(transform_func){
            //FIXME
        }
    });

    set_global('Post', class Post extends IDElementWrapper {
        constructor(element){
            super(element);

            this._comments = []

            this._before_edit_callbacks = [];
        }

        static from_element(element){
            if (this !== Post)
                return super.from_element(element);

            if (element.dataset.questionid === undefined)
                return Answer.from_element(element);
            else
                return Question.from_element(element);
        }

        static from_child_element(element){
            const root_elem = find_parent(element, e => e.id === 'question' || e.classList.contains('answer'));
            return this.from_element(root_elem);
        }

        get type(){
            return this.constructor;
        }

        get author(){
            const users = this.getElementsByClassName('user-details');
            const author_element = users[users.length-1];
            const link = author_element.querySelector('a');
            return User.from_link(link);
        }

        get timeline_url(){
            return document.location.href.replace(/\/questions\/.*/, '/posts/'+this.id+'/timeline');
        }

        get menu_element(){
            return this.querySelector('.post-menu');
        }

        get comments(){
            const comments_elem = this.querySelector('.comments-list');
            const comments = Array.from(comments_elem.getElementsByClassName('comment'));
            this._comments = comments.map(e => Comment.from_element(e));
            return this._comments;
        }

        parse_content(){
            return new PostBodyRoot.from_element(this.element);
        }

        extract_text(){
            const body = this.querySelector('.post-text');
            return body.textContent.trim();
        }

        before_edit(func){
            this._before_edit_callbacks.push(func);
            if (this._before_edit_callbacks.length > 1)
                return;

            // if this is the first callback that's been connected, add the
            // relevant events
            const edit_button = this.element.querySelector('.edit-post');
            before_click(edit_button, () => this._trigger_before_edit());
        }
        _trigger_before_edit(){
            for (var func of this._before_edit_callbacks)
                func(this);
        }
    });
    Post._instances_by_id = new Map();

    set_global('Question', class Question extends QuestionActionsMixin(Post) {
        static _get_id(element){
            return element.dataset.questionid;
        }
        
        get title(){
            const header = document.getElementById('question-header');
            const title = header.firstElementChild.textContent;
            return title.replace(/ \[(?:duplicate|on hold)\]$/, '');
        }

        get tags(){
            const tags_element = this.querySelector('.post-taglist');
            const tags = Array.from(tags_element.getElementsByClassName('post-tag'));
            return tags.map(e => e.textContent);
        }
    });

    set_global('Answer', class Answer extends AnswerActionsMixin(Post) {
        static _get_id(element){
            return element.dataset.answerid;
        }
    });

    set_global('Comment', class Comment extends IDElementWrapper {
        constructor(element){
            super(element);

            this._author = null;

            this._before_edit_callbacks = [];
        }

        static from_child_element(element){
            const root_elem = find_parent(element, e => e.classList.contains('comment'));
            return this.from_element(root_elem);
        }

        static _get_id(element){
            return element.dataset.commentId;
        }
        
        get score(){
            const score_elem = this.querySelector('.comment-score');
            
            const score_span = score_elem.querySelector('span');
            if (score_span === null)
                return 0;
            
            return parseInt(score_span.textContent);
        }

        get author(){
            if (this._author === null){
                const link = this.querySelector('a.comment-user');
                this._author = User.from_link(link);
            }
            return this._author;
        }

        get text(){
            const elem = this.querySelector('.comment-copy');
            return elem.textContent;
        }
        set text(text){
            const elem = this.querySelector('.comment-copy');
            elem.textContent = text;
        }

        add_text(text){
            const elem = this.querySelector('.comment-copy');
            const last_child = elem.lastChild;

            if (last_child.nodeType === Node.TEXT_NODE)
                last_child.textContent += text;
            else {
                const text_node = document.createTextNode(text);
                elem.appendChild(text_node);
            }
        }
    });
    Comment._instances_by_id = new Map();

    set_global('User', class User {
        constructor(id, name){
            this.id = id;
            this.name = name;
        }

        static from_id(id){
            id = id + "";

            var user = _users_by_id.get(id);
            if (user !== undefined)
                return user;

            user = new User(id);
            _users_by_id.set(id, user);
            return user;
        }

        static from_link(element){
            const match = /\/users\/(\d+)\/(.*)/.exec(element.href);
            const user = this.from_id(match[1]);
            user.name = match[2];
            return user;
        }

        static from_element(element){
            const a = element.querySelector('.user-details a');
            const user = this.from_link(a);
            return user;
        }
    });

    // === Post body elements start here ===
    set_global('PostBodyElement', class PostBodyElement extends BaseClass {
        extract_text(){
            return '';
        }
    });

    set_global('PostBodyContainer', class PostBodyContainer extends PostBodyElement {
        constructor(children){
            super();
            this.children = children;
        }

        static parse_child_elements(element){
            var elements = [];

            const CLASSES = [PostBodyText, PostBodyCodeBlock, PostBodyInlineCode,
                            PostBodyJSSnippet, PostBodyUrl, PostBodyBold,
                            PostBodyItalicized, PostBodyBlockQuote, PostBodyImage,
                            PostBodyList, PostBodyHeading, PostBodySeparator,
                            PostBodyLineBreak];

            var children;
            if (['P','EM','STRONG','CODE','A','H1','H2','H3','H4','H5','LI'].includes(element.tagName))
                children = element.childNodes;
            else
                children = element.children;

            for (const elem of children){
                if (elem.tagName === 'P'){
                    const elems = this.parse_child_elements(elem);
                    elements = elements.concat(elems);
                    elements.push(new PostBodyElementSeparator());
                    continue;
                }

                // ignore "question already has an answer here" headers
                if (elem.tagName === 'DIV' && elem.classList.contains('question-status'))
                    continue;

                var parsed_element = null;
                for (const cls of CLASSES){
                    parsed_element = cls.from_element(elem);
                    if (parsed_element !== null)
                        break;
                }
                if (parsed_element === null)
                    parsed_element = new PostBodyERROR('failed to parse element: '+elem.tagName);
                else if (parsed_element.is_a(PostBodyDummyElement))
                    continue;

                elements.push(parsed_element);
            }

            // merge Text elements separated only by ElementSeparators into a single Text element
            for (var i = 0; i < elements.length-2;) {
                if (!elements[i].is_a(Text)
                        || !elements[i+1].is_a(PostBodyElementSeparator)
                        || !elements[i+2].is_a(PostBodyText)){
                    i++;
                    continue;
                }

                elements[i].text += '\n\n' + elements[i+2].text;
                elements.splice(i+1, 2); // remove the next 2 elements
            }

            return elements;
        }

        extract_text(){
            return this.children.map(e => e.extract_text()).join('');
        }

        clone_without_children(){
            const children = this.children;
            this.children = [];
            const clone = this.clone();
            this.children = children;
            return clone;
        }

        to_markup(){
            const SEP_TYPES = [PostBodyCodeBlock, PostBodyList];

            const chunks = [];
            var prev_child = null;
            for (const child of this.children){
                if (child.is_any(SEP_TYPES) && prev_child !== null && prev_child.is_any(SEP_TYPES))
                    chunks.push('\n\n<!-- -->\n');

                chunks.push(child.to_markup());
                prev_child = child;
            }
            return chunks.join("");
        }
    });

    set_global('PostBodyERROR', class PostBodyERROR extends PostBodyElement {
        constructor(message){
            super();
            this.message = message;
        }

        to_markup(){
            return '<<<ERROR:' + this.message + '>>>';
        }
    });

    set_global('PostBodyDummyElement', class PostBodyDummyElement extends PostBodyElement {
        to_markup(){
            return '';
        }
    });

    set_global('PostBodyElementSeparator', class PostBodyElementSeparator extends PostBodyElement {
        to_markup(){
            return '\n\n';
        }
    });

    set_global('PostBodyCodeBlockSeparator', class PostBodyCodeBlockSeparator extends PostBodyElement {
        to_markup(){
            return '\n<!-- -->\n';
        }
    });
    
    set_global('PostBodyLineBreak', class PostBodyLineBreak extends PostBodyElement {
        static from_element(element){
            if (element.tagName !== 'BR')
                return null;

            return new this(element);
        }
        
        to_markup(){
            return '<br>';
        }
    });

    set_global('PostBodyRoot', class PostBodyRoot extends PostBodyContainer {
        constructor(children, tags){
            super(children);
            this.tags = tags;
        }

        static from_element(element){
            var post_body = element.querySelector(".post-text");
            if (post_body === null)
                post_body = element;

            const children = super.parse_child_elements(post_body);

            const tag_list = element.querySelector('.post-taglist');
            let tags;
            if (tag_list === null)
                tags = null;
            else
                tags = Array.from(tag_list.getElementsByClassName('post-tag')).map(e => e.textContent);

            return new this(children, tags);
        }

        static from_child_element(element){
            while (!element.classList.contains('question') && !element.classList.contains('answer'))
                element = element.parentElement;

            return this.from_element(element);
        }

        to_markup(){
            const markup = super.to_markup();
            return markup.replace(/(?:\n *){2,}(?=\n|$)/g, '\n');
        }
    });

    set_global('PostBodyUrl', class PostBodyUrl extends PostBodyContainer {
        constructor(url, children){
            super(children);
            this.url = url;
        }

        static from_element(element){
            if (element.tagName !== 'A')
                return null;

            const children = super.parse_child_elements(element);
            return new this(element.href, children);
        }

        to_markup(){
            const body = super.to_markup();
            return '[' + body + '](' + this.url + ')';
        }
    });

    set_global('PostBodyCodeBlock', class PostBodyCodeBlock extends PostBodyElement {
        constructor(code){
            super();
            this.code = code;
        }

        static from_element(element){
            if (element.tagName !== "PRE" /*|| !element.classList.contains("prettyprint")*/)
                return null;

            return new this(element.textContent.trimRight());
        }

        extract_text(){
            return this.code;
        }

        to_markup(){
            return "\n\n    " + this.code.split("\n").join("\n    ") + "\n\n";
        }
    });

    set_global('PostBodyInlineCode', class PostBodyInlineCode extends PostBodyElement {
        constructor(code){
            super();
            this.code = code;
        }

        static from_element(element){
            if (element.tagName !== 'CODE')
                return null;

            return new this(element.textContent);
        }

        extract_text(){
            return this.code;
        }

        to_markup(){
            if (this.code.includes('`'))
                return '<code>' + this.code + '</code>';
            return '`' + this.code + '`';
        }
    });

    set_global('PostBodyJSSnippet', class PostBodyJSSnippet extends PostBodyElement {
        constructor(code){
            super();
            this.code = code;
        }

        static from_element(element){
            if (element.tagName === 'SUP'){
                const a = element.querySelector('a.edit-snippet');
                if (a !== null)
                    return new PostBodyDummyElement();

                return null;
            }

            if (element.tagName !== "DIV" || !element.classList.contains("snippet"))
                return null;

            const code_element = element.querySelector('code');
            return new this(code_element.textContent.trimRight());
        }

        extract_text(){
            return this.code;
        }

        to_markup(){
            return "\n\n<!-- begin snippet: js hide: false console: true babel: false -->\n\n<!-- language: lang-js -->" + this.code.split("\n").join("\n    ") + "\n\n<!-- end snippet -->\n\n";
        }
    });

    set_global('PostBodyText', class PostBodyText extends PostBodyElement {
        constructor(text){
            super();
            this.text = text;
        }

        extract_text(){
            return this.text;
        }

        static from_element(element){
            if (element.nodeType !== Node.TEXT_NODE)
                return null;

            const text = element.textContent;
            return new this(text);
        }

        to_markup(){
            var markup = this.text;
            
            // escape formatting characters
            markup = markup.replace(/([*_])/g, '\\$1');
            
            return markup;
        }
    });

    set_global('PostBodyBold', class PostBodyBold extends PostBodyContainer {
        constructor(children){
            super(children);
        }

        static from_element(element){
            if (element.tagName !== 'STRONG')
                return null;

            const children = super.parse_child_elements(element);
            return new this(children);
        }

        to_markup(){
            const body = super.to_markup();
            return '**' + body + '**';
        }
    });

    set_global('PostBodyItalicized', class PostBodyItalicized extends PostBodyContainer {
        constructor(children){
            super(children);
        }

        static from_element(element){
            if (element.tagName !== 'EM')
                return null;

            const children = super.parse_child_elements(element);
            return new this(children);
        }

        to_markup(){
            const body = super.to_markup();
            return '*' + body + '*';
        }
    });

    set_global('PostBodyBlockQuote', class PostBodyBlockQuote extends PostBodyContainer {
        constructor(children){
            super(children);
        }

        static from_element(element){
            if (element.tagName !== 'BLOCKQUOTE')
                return null;

            const children = super.parse_child_elements(element);
            return new this(children);
        }

        to_markup(){
            const body = super.to_markup().trimRight();
            return '\n\n> ' + body.split('\n').join('\n> ') + '\n\n';
        }
    });
    
    set_global('PostBodyHeading', class PostBodyHeading extends PostBodyContainer {
        constructor(children, rank){
            super(children);
            this.rank = rank;
        }

        static from_element(element){
            const match = /^H(\d)$/.exec(element.tagName);
            if (match === null)
                return null;

            const children = super.parse_child_elements(element);
            const rank = parseInt(match[1]);
            return new this(children, rank);
        }

        to_markup(){
            const body = super.to_markup();
            return '#'.repeat(this.rank) + ' ' + body + '\n\n';
        }
    });

    set_global('PostBodyImage', class PostBodyImage extends PostBodyElement {
        constructor(src, description){
            super();
            this.src = src;
            this.description = description;
        }

        static from_element(element){
            if (element.tagName !== 'IMG')
                return null;

            return new this(element.src, element.alt);
        }

        to_markup(){
            return '!['+this.description+']('+this.src+')';
        }
    });

    set_global('PostBodySeparator', class PostBodySeparator extends PostBodyElement {
        static from_element(element){
            if (element.tagName !== 'HR')
                return null;

            return new this();
        }

        to_markup(){
            return '\n\n----------\n\n';
        }
    });

    set_global('PostBodyList', class PostBodyList extends PostBodyContainer {
        constructor(children, enumerate){
            super(children);
            this.enumerate = enumerate;
        }

        static from_element(element){
            if (element.tagName !== 'OL' && element.tagName !== 'UL')
                return null;

            const enumerate = element.tagName == 'OL';
            const children = [];
            for (const child of element.childNodes){
                if (child.tagName !== 'LI')
                    continue;

                children.push(PostBodyListItem.from_element(child));
            }
            return new this(children, enumerate);
        }

        to_markup(){
            const chunks = [];
            var num = 1;
            for (var child of this.children){
                var text = child.to_markup();
                text = text.split('\n').join('\n    ');

                const marker = this.enumerate ? num+'.' : '- ';
                chunks.push(' '+marker+' '+text);
                num++;
            }
            return chunks.join('\n') + '\n\n';
        }
    });
    set_global('PostBodyListItem', class PostBodyListItem extends PostBodyContainer {
        static from_element(element){
            if (element.tagName !== 'LI')
                return null;

            const children = this.parse_child_elements(element);
            return new this(children);
        }
    });

    // depending on the url, instantiate the correct Page class
    const url = window.location.href;
    if (url.includes('/questions/')){
        if (url.includes('/tagged/'))
            set_global('page', new QuestionListPage());
        else if (!url.includes('/originals/')){
            set_global('page', new QuestionPage());
            set_global('question', page.question);
        }
    }
})();

